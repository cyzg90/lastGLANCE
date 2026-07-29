import Foundation
import Capacitor
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
// Registration: Capacitor discovers app-local plugins through the Objective-C
// runtime, so @objc + CAPBridgedPlugin conformance is all that is required — no
// .m file and no manual registration call.
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
        call.resolve()
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
