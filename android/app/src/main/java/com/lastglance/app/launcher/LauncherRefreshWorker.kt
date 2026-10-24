package com.lastglance.app.launcher

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.lastglance.app.SharedDataStore
import com.lastglance.app.intents.IntentReceiver
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/**
 * The launcher's REFRESH at a dead process (docs/launcher-integration.md,
 * "Freshness"). Ported from dayGLANCE's worker of the same name.
 * [LauncherIntentReceiver] enqueues one of these when no renderer exists; it
 * boots the web bundle in a WebView with no Activity, at
 * `https://localhost/index.html?headless=refresh&clientId=…`, where main.tsx
 * runs src/headless/headlessRefresh.ts: one cycle of every sync road the app's
 * own REFRESH runs, then the launcher snapshot and heartbeat are pushed and the
 * outcome is reported through [HeadlessBridge.headlessDone].
 *
 * Capacitor needs an Activity, so this WebView has no Capacitor bridge. It
 * loads the app's own files at the app's own origin (Capacitor serves
 * `assets/public` at https://localhost), so it shares the app's IndexedDB and
 * localStorage, and [HeadlessBridge] stands in for the plugins a run uses.
 *
 * Expedited, network-constrained, unique (KEEP): one run answers every REFRESH
 * that arrives while it waits. [HeadlessRefreshPolicy] decides what a run does
 * once the worker gets to execute: hand over to a renderer that has appeared in
 * the meantime, throttle (ten-minute floor between headless runs), or run under
 * a two-minute cap, and tear down a page that never starts the headless root.
 *
 * The REVERSE LOCK: if the user opens the app during a run,
 * [abortForLiveInstance] runs first thing in MainActivity.onCreate, on the main
 * thread, and destroys this WebView before the live one loads; the web root
 * also asks `headlessShouldAbort` at each phase boundary. Signal-abort, not
 * wait: the live instance runs its own cycle at start, and a run has no local
 * edits to lose.
 *
 * Every step lands in the refresh log the launcher's diagnostics show:
 * `scheduled` at the receiver, then `startedAt` and `waitMs` (how long the OS
 * held the job) when the worker runs, then `ran`/`failed` from the web layer
 * or `aborted`/`throttled`/`failed` with a reason from here.
 */
class LauncherRefreshWorker(
    private val appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    /** One headless WebView and its outcome; the bridge and the abort hook hold it. */
    class Run(val clientId: String) {
        @Volatile var abortRequested: Boolean = false
            private set
        /** Set by the first bridge call: the page is running the headless root. */
        @Volatile var started: Boolean = false
            private set
        @Volatile var rendererGone: Boolean = false
        @Volatile var webView: WebView? = null
        /** The web layer's outcome JSON, or null when the worker had to decide. */
        val done = CompletableDeferred<String?>()

        fun markStarted() { started = true }

        fun finish(json: String?) { done.complete(json) }

        /** Main thread only: stop the page and release the WebView. */
        fun abort() {
            abortRequested = true
            teardown()
            done.complete(null)
        }

        fun teardown() {
            val wv = webView ?: return
            webView = null
            try {
                wv.stopLoading()
                wv.loadUrl("about:blank")
                wv.destroy()
            } catch (e: Exception) {
                Log.w(TAG, "headless WebView teardown", e)
            }
        }
    }

    override suspend fun doWork(): Result {
        val clientId = inputData.getString(KEY_CLIENT_ID) ?: return Result.success()
        val now = System.currentTimeMillis()
        val lastRunAt = SharedDataStore.launcherHeadlessLastRunAt(appContext)
        when (val decision = HeadlessRefreshPolicy.decide(LauncherBridgePlugin.rendererAlive, lastRunAt, now)) {
            is HeadlessRefreshPolicy.Decision.HandToLive -> handToLive(clientId, now)
            is HeadlessRefreshPolicy.Decision.Throttled ->
                patch(clientId, JSONObject().put("outcome", "throttled").put("reason", HeadlessRefreshPolicy.throttledReason(decision.sinceLastMs)).put("finishedAt", now))
            is HeadlessRefreshPolicy.Decision.Run -> run(clientId, now)
        }
        return Result.success()
    }

    /** The renderer came up while the job waited: the alive path answers this REFRESH. */
    private fun handToLive(clientId: String, now: Long) {
        val queued = JSONObject()
            .put("action", LauncherIntentReceiver.ACTION_REFRESH)
            .put("payload", JSONObject())
            .put("clientId", clientId)
            .put("receivedAt", now)
        SharedDataStore.appendPendingLauncherIntent(appContext, queued.toString())
        patch(clientId, JSONObject().put("outcome", "queued").put("reason", "renderer alive when the worker ran").put("liveness", "alive"))
        // As the receiver's alive path: held awake until the web layer answers.
        try {
            LauncherAwakeWorker.schedule(appContext, clientId)
        } catch (e: Exception) {
            Log.w(TAG, "Could not hold the app awake for a refresh", e)
        }
        appContext.sendBroadcast(Intent(IntentReceiver.INTENT_RECEIVED).setPackage(appContext.packageName))
    }

    private suspend fun run(clientId: String, startedAt: Long) {
        // Stamped at the start so a crash mid-run still counts toward the floor.
        SharedDataStore.setLauncherHeadlessLastRunAt(appContext, startedAt)
        val requestedAt = SharedDataStore.launcherRefreshEntry(appContext, clientId)?.optLong("requestedAt", startedAt) ?: startedAt
        patch(clientId, JSONObject().put("startedAt", startedAt).put("waitMs", startedAt - requestedAt).put("headless", true))

        val run = Run(clientId)
        val booted = withContext(Dispatchers.Main) {
            // Same thread as MainActivity.onCreate: either the renderer is alive
            // already (hand over) or an opening app will find `current` and abort it.
            if (LauncherBridgePlugin.rendererAlive) return@withContext false
            current = run
            run.webView = buildWebView(run)
            run.webView?.loadUrl("$ENTRY?headless=refresh&clientId=${android.net.Uri.encode(clientId)}")
            Log.i(TAG, "headless refresh $clientId: WebView booted")
            true
        }
        if (!booted) { handToLive(clientId, System.currentTimeMillis()); return }

        val reported = withTimeoutOrNull(HeadlessRefreshPolicy.CAP_MS) {
            // A page that never calls the bridge is not the headless root (a
            // stale cached bundle renders App instead): tear it down early.
            val starting = withTimeoutOrNull(HeadlessRefreshPolicy.BOOT_MS) {
                while (!run.started && !run.done.isCompleted) delay(250)
            }
            if (starting == null) null else run.done.await()
        }
        val timedOut = !run.done.isCompleted
        withContext(Dispatchers.Main) {
            if (current === run) current = null
            run.teardown()
        }
        if (reported == null) {
            val (outcome, reason) = HeadlessRefreshPolicy.unreportedOutcome(run.abortRequested, timedOut, run.rendererGone, run.started)
            patch(clientId, JSONObject().put("outcome", outcome).put("reason", reason).put("finishedAt", System.currentTimeMillis()))
            Log.w(TAG, "headless refresh $clientId: $outcome ($reason)")
        } else {
            recordReport(clientId, reported)
            Log.i(TAG, "headless refresh $clientId: $reported")
        }
    }

    /** The web layer's report ({clientId, outcome, reason?, durationMs}) into the log entry. */
    private fun recordReport(clientId: String, json: String) {
        patch(clientId, HeadlessRefreshPolicy.reportPatch(json, System.currentTimeMillis()))
    }

    private fun buildWebView(run: Run): WebView {
        val assets = assetLoader(appContext)
        // The app's PWA service worker controls https://localhost in this
        // profile. Capacitor routes its requests to its local server; with no
        // Capacitor in the process, they come here, so its update check still
        // sees the installed files. MainActivity's bridge sets its own again.
        ServiceWorkerController.getInstance().setServiceWorkerClient(object : ServiceWorkerClient() {
            override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)
        })
        val webView = WebView(appContext)
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            // The headless page never navigates; anything else is refused.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != HOST && request.url.toString() != "about:blank"

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                run.rendererGone = true
                run.webView = null
                run.finish(null)
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    Log.w(TAG, "headless js: ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                }
                return true
            }
        }
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        // Delivered through the main Looper, NEVER through webView.post: a View
        // that is not attached to a window holds its posted runnables until it
        // is attached, and this WebView never is (dayGLANCE's first device run
        // hung on exactly that).
        val bridge = HeadlessBridge(appContext, run) { json ->
            mainHandler.post {
                run.webView?.evaluateJavascript("window.__lgHeadlessHttpDone && window.__lgHeadlessHttpDone($json)", null)
            }
        }
        webView.addJavascriptInterface(bridge, "LastGlanceHeadless")
        return webView
    }

    private fun patch(clientId: String, patch: JSONObject) {
        SharedDataStore.updateLauncherRefresh(appContext, clientId, patch)
        appContext.contentResolver.notifyChange(LauncherProvider.CONTENT_URI, null)
    }

    /** Only asked for below Android 12, where an expedited job runs as a foreground service. */
    override suspend fun getForegroundInfo(): ForegroundInfo = LauncherForeground.info(appContext, NOTIFICATION_ID)

    companion object {
        private const val TAG = "LauncherRefresh"
        const val UNIQUE_WORK_NAME = "launcher-headless-refresh"
        private const val KEY_CLIENT_ID = "clientId"
        private const val NOTIFICATION_ID = 7310
        /** Capacitor's origin (CapConfig: androidScheme https, hostname localhost); the storage lives there. */
        private const val HOST = "localhost"
        private const val ENTRY = "https://$HOST/index.html"
        private val mainHandler = Handler(Looper.getMainLooper())

        /** The run in progress, if any; main thread writes. */
        @Volatile private var current: Run? = null

        /** Whether a headless WebView exists right now (the provider's `meta.headlessRunning`). */
        @JvmStatic
        val running: Boolean get() = current != null

        /** The app's web assets (`assets/public`, where `cap sync` puts them) at Capacitor's origin. */
        private fun assetLoader(context: Context): WebViewAssetLoader =
            WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/", WebViewAssetLoader.PathHandler { path ->
                    val file = path.ifEmpty { "index.html" }
                    try {
                        WebResourceResponse(mimeOf(file), "utf-8", context.assets.open("public/$file"))
                    } catch (e: Exception) {
                        null
                    }
                })
                .build()

        private fun mimeOf(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
            "html" -> "text/html"
            "js", "mjs" -> "application/javascript"
            "css" -> "text/css"
            "json", "webmanifest" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "ico" -> "image/x-icon"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "wasm" -> "application/wasm"
            else -> "application/octet-stream"
        }

        /** Enqueue one run for [clientId]; a run already queued or running answers it too (KEEP). */
        fun schedule(context: Context, clientId: String) {
            val request = OneTimeWorkRequestBuilder<LauncherRefreshWorker>()
                .setInputData(Data.Builder().putString(KEY_CLIENT_ID, clientId).build())
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }

        /**
         * The reverse lock's trigger: the app is about to create its renderer.
         * Main thread (MainActivity.onCreate, before the bridge loads and sets
         * `rendererAlive`). A run between its liveness check and its WebView has
         * not set `current` yet; it re-checks liveness on this same thread
         * before booting.
         */
        @JvmStatic
        fun abortForLiveInstance() {
            val run = current ?: return
            current = null
            Log.i(TAG, "headless refresh ${run.clientId}: aborted, the app opened")
            run.abort()
        }
    }
}
