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
//
// The dual membership is what makes the OpenURLIntent chain below reachable;
// it is not an alternative to it. Both are required.

// Opens the app straight into the new-chore form — the Quick Settings
// add-chore tile, relocated to where iOS puts such things.
//
// The intent's ONLY job is to hand back an OpenURLIntent for the same
// lastglance:// URL every other entry point uses; the app then receives it
// through the AppDelegate URL path, which is device-verified. Two designs
// that look right do not work from a control, learned the hard way:
//  - `openAppWhenRun` alone is ignored when the intent runs in the widget
//    extension process — which is exactly where a control button's intent
//    runs. The tap performed, wrote its token, and nothing opened.
//  - Writing the pending token from the intent also had a warm-open race:
//    the app's foreground drain could run before the token landed.
// Chaining OpenURLIntent solves both: the system opens the URL itself, and
// the token is minted by AppDelegate on receipt, exactly as for a widget tap.
@available(iOS 18.0, *)
struct OpenAddChoreIntent: AppIntent {
    static let title: LocalizedStringResource = "Add chore"
    static let isDiscoverable = false
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(URL(string: "lastglance://action/add")!))
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
