import UIKit
import Capacitor

// UIScene lifecycle. iOS 27 refuses to launch an app that still uses the
// legacy app-delegate-only window lifecycle (it traps in
// _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption), so the
// window now lives on this scene, configured by UIApplicationSceneManifest in
// Info.plist. The Main storyboard (BridgeViewController) is loaded into
// `window` by UIKit via UISceneStoryboardFile.
//
// Once scenes are adopted UIKit no longer calls the app-delegate URL, shortcut
// and user-activity callbacks; those events arrive here instead, both as
// connection options on a cold start and as scene callbacks on a warm one.
// Each is forwarded to the same handling AppDelegate owns.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        if let context = connectionOptions.urlContexts.first {
            AppDelegate.handleOpenURL(context.url, options: context.options)
        }
        if let shortcutItem = connectionOptions.shortcutItem {
            _ = AppDelegate.handleShortcut(shortcutItem)
        }
        for activity in connectionOptions.userActivities {
            AppDelegate.handleUserActivity(activity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            AppDelegate.handleOpenURL(context.url, options: context.options)
        }
    }

    func windowScene(_ windowScene: UIWindowScene,
                     performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        completionHandler(AppDelegate.handleShortcut(shortcutItem))
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        AppDelegate.handleUserActivity(userActivity)
    }
}
