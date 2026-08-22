import Foundation
import Capacitor
import UIKit
import WidgetKit

// iOS counterpart of WidgetBridgePlugin.java. Receives the denormalized snapshot
// from the web app, persists it in the App Group for the widget extensions to
// render from, and hands back anything the extensions queued while the WebView
// was not running.
//
// The JS interface is fixed by src/native/widgetBridge.ts and must stay
// byte-identical to the Android plugin's, so widgetBridge.ts needs no per-platform
// branching: updateSnapshot / drainPendingCompletions / consumeDeepLink /
// consumeSharedChore.
//
// Registration: app-local plugins are NOT auto-discovered on iOS (Capacitor 5+
// removed runtime scanning); this plugin is registered explicitly in
// BridgeViewController.capacitorDidLoad(), alongside VaultSsePlugin — the same
// pattern lifeGLANCE uses in its MainViewController.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "updateSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainPendingCompletions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeDeepLink", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeSharedChore", returnType: CAPPluginReturnPromise),
    ]

    @objc func updateSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("missing json")
            return
        }
        // A missing App Group is the one failure worth surfacing: everything else
        // in this plugin degrades to "no data", which is indistinguishable from a
        // fresh install. widgetBridge.ts swallows the rejection, so this only ever
        // shows up in native logs — which is exactly where it is useful.
        guard SharedDataStore.isAvailable else {
            call.reject("app group \(SharedDataStore.suiteName) unavailable")
            return
        }
        SharedDataStore.writeSnapshot(json)
        // Unlike Android, there is no per-widget broadcast to target: WidgetKit
        // reloads every placed timeline for this app. Cheap, because our providers
        // only read a JSON blob out of UserDefaults.
        WidgetCenter.shared.reloadAllTimelines()
        refreshShortcuts(json: json)
        call.resolve()
    }

    // Rebuild the home-screen quick actions from the snapshot — the analogue of
    // WidgetShortcuts.refresh on Android, with the same priority order: Add,
    // Search, then the most-overdue chores. iOS shows at most four, so the
    // data-driven tail is two chores (Android trims to the launcher's max the
    // same way, lowest priority first).
    //
    // Each item's `type` is the internal deep-link token itself; AppDelegate's
    // performActionFor validates and stores it verbatim. Parsed with
    // JSONSerialization rather than a model on purpose — this file lives in the
    // app target and has no reason to grow a dependency on the widget target's
    // snapshot model for two fields.
    private func refreshShortcuts(json: String) {
        var items: [UIApplicationShortcutItem] = [
            UIApplicationShortcutItem(
                type: "action:add",
                localizedTitle: "Add chore",
                localizedSubtitle: nil,
                icon: UIApplicationShortcutIcon(type: .add),
                userInfo: nil
            ),
            UIApplicationShortcutItem(
                type: "action:search",
                localizedTitle: "Search",
                localizedSubtitle: nil,
                icon: UIApplicationShortcutIcon(type: .search),
                userInfo: nil
            ),
        ]

        if let root = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any],
           let chores = root["chores"] as? [[String: Any]] {
            let ranked = chores
                .filter { ($0["state"] as? String) == "overdue" || ($0["state"] as? String) == "soon" }
                .sorted {
                    (($0["ratio"] as? Double) ?? 0) > (($1["ratio"] as? Double) ?? 0)
                }
                .prefix(2)
            for chore in ranked {
                guard let syncId = chore["syncId"] as? String,
                      let name = chore["name"] as? String, !name.isEmpty else { continue }
                items.append(UIApplicationShortcutItem(
                    type: "chore:\(syncId)",
                    localizedTitle: name,
                    localizedSubtitle: nil,
                    icon: UIApplicationShortcutIcon(type: .task),
                    userInfo: nil
                ))
            }
        }

        DispatchQueue.main.async {
            UIApplication.shared.shortcutItems = items
        }
    }

    @objc func drainPendingCompletions(_ call: CAPPluginCall) {
        call.resolve(["completions": SharedDataStore.readAndClearPendingCompletions()])
    }

    @objc func consumeDeepLink(_ call: CAPPluginCall) {
        // NSNull rather than nil: Capacitor drops nil values from the result
        // dictionary, and widgetBridge.ts reads `res?.deepLink ?? null`, so an
        // absent key and an explicit null both land on null. Explicit is clearer.
        call.resolve(["deepLink": SharedDataStore.readAndClearPendingDeepLink() ?? NSNull()])
    }

    @objc func consumeSharedChore(_ call: CAPPluginCall) {
        call.resolve(["text": SharedDataStore.readAndClearPendingSharedChore() ?? NSNull()])
    }
}
