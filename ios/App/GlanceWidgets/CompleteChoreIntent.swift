import AppIntents

// The Done button. Interactive widget buttons run their AppIntent inside the
// widget extension process — no app launch, no WebView — which is the whole
// reason the completion path goes through the App-Group queue instead of the
// Capacitor bridge: there is no bridge here. The app replays the queue into
// IndexedDB on next foreground (drainWidgetCompletions), idempotent on the
// sync_id CompletionStore mints.
struct CompleteChoreIntent: AppIntent {
    static let title: LocalizedStringResource = "Mark chore done"
    // Widget-internal plumbing, not a user-facing automation: keep it out of
    // the Shortcuts app's action list.
    static let isDiscoverable = false

    @Parameter(title: "Chore")
    var choreSyncId: String

    init() {}

    init(choreSyncId: String) {
        self.choreSyncId = choreSyncId
    }

    func perform() async throws -> some IntentResult {
        CompletionStore.complete(choreSyncId: choreSyncId)
        return .result()
    }
}
