import SwiftUI
import WidgetKit
import AppIntents

// Control Center control (iOS 18+) and the intent behind it.
//
// THIS FILE MUST BE A MEMBER OF BOTH THE App AND GlanceWidgetsExtension
// TARGETS. A control button can only trigger an AppIntent, and iOS resolves
// that intent against the *app's* AppIntents metadata when deciding whether it
// may open the app. While this lived in GlanceWidgets/AccessoryWidgets.swift,
// which is compiled into the extension alone, tapping the control did nothing
// at all. That is why it sits in App/Shared/ next to SharedDataStore.swift,
// the repo's existing both-targets home, rather than beside the widgets it
// belongs to conceptually.

// Opens the app straight into the new-chore form — the Quick Settings
// add-chore tile, relocated to where iOS puts such things.
//
// TWO INDEPENDENT HALVES, AND THE DESTINATION MUST NOT RIDE ON EITHER ONE.
//
// Opening the app and saying WHERE to go are separate problems here, and the
// system decides which of the two open mechanisms below it honours:
//
//  - `openAppWhenRun` foregrounds the app but carries no destination. It is
//    ignored while the app target cannot see this intent, which is why the
//    control did nothing before the file gained its App-target membership —
//    and it is what opens the app now that it can.
//  - The chained `OpenURLIntent` carries the destination in the URL, and the
//    app receives it through the AppDelegate URL path every widget body-tap
//    already uses. But the system will not necessarily perform it once
//    `openAppWhenRun` has already satisfied "open the app".
//
// So `perform()` writes the pending token itself, BEFORE handing back the
// open. That is the half that cannot be dropped: whichever mechanism actually
// foregrounds the app, the destination is already in the App Group for
// usePendingDeepLink to drain on mount or on the foreground visibilitychange.
//
// Deleting this write is precisely how the control regressed from "does
// nothing" to "opens the app on the wrong screen": it was removed in favour of
// the OpenURLIntent chain alone, at a point when the control could not open
// the app at all, so the chain was never actually observed to deliver the URL.
//
// The OpenURLIntent is kept, not redundant. If the system does perform it,
// AppDelegate maps the same URL to the same "action:add" token and writes it
// to the same single slot — same value, consumed once by
// readAndClearPendingDeepLink, so at most one new-chore form either way.
@available(iOS 18.0, *)
struct OpenAddChoreIntent: AppIntent {
    static let title: LocalizedStringResource = "Add chore"
    static let isDiscoverable = false
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult & OpensIntent {
        // Runs to completion in the widget extension process before the system
        // opens the app, so the token is in the shared container ahead of any
        // drain the foregrounding app can run.
        SharedDataStore.writePendingDeepLink("action:add")
        return .result(opensIntent: OpenURLIntent(URL(string: "lastglance://action/add")!))
    }
}

@available(iOS 18.0, *)
struct AddChoreControl: ControlWidget {
    let kind = "AddChoreControl"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: kind) {
            ControlWidgetButton(action: OpenAddChoreIntent()) {
                Label("Add chore", systemImage: "plus.circle")
            }
        }
        .displayName("Add chore")
        .description("Open lastGLANCE ready to add a new chore.")
    }
}
