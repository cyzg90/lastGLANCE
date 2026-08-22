import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // lastglance:// is the app's own navigation scheme (widget body-taps,
        // home-screen shortcuts). Map it to the internal token the web router
        // consumes and stash it in the App Group — the same hand-off
        // MainActivity.captureWidgetDeepLink does on Android. The web app owns
        // navigation; this just records the target, which usePendingDeepLink
        // picks up on mount (cold start) or on the visibilitychange the
        // foregrounding causes (warm start).
        if url.scheme == "lastglance" {
            if let token = AppDelegate.deepLinkToken(from: url) {
                SharedDataStore.writePendingDeepLink(token)
            }
            return true
        }
        // Anything else (OAuth callbacks etc.) keeps the Capacitor path.
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    // Home-screen quick actions (long-press the app icon). The item's `type` IS
    // the internal deep-link token — WidgetBridgePlugin builds the items that
    // way — so handling is a validity check and a store, nothing more. UIKit
    // calls this for both warm taps and cold starts (after didFinishLaunching).
    func application(_ application: UIApplication,
                     performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        let token = shortcutItem.type
        let valid = token.hasPrefix("chore:")
            || token == "filter:soon" || token == "action:add" || token == "action:search"
        if valid {
            SharedDataStore.writePendingDeepLink(token)
        }
        completionHandler(valid)
    }

    // Map a lastglance:// URL to the internal pending-deep-link token the web
    // app consumes — the exact mirror of MainActivity.linkFromUri. Returns nil
    // for anything unrecognized rather than guessing.
    static func deepLinkToken(from url: URL) -> String? {
        switch url.host {
        case "chore":
            let id = url.lastPathComponent
            return (id.isEmpty || id == "/") ? nil : "chore:\(id)"
        case "filter":
            return "filter:soon"
        case "action":
            switch url.lastPathComponent {
            case "search": return "action:search"
            case "add": return "action:add"
            default: return nil
            }
        default:
            return nil
        }
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
