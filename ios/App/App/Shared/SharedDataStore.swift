import Foundation

// Single App Group store shared between the Capacitor bridge (writer, in the app
// process) and the widget/share extensions (readers, in their own processes).
// The direct counterpart of Android's SharedDataStore.java, deliberately kept to
// the same tiny surface: the web app is the source of truth, this is only the
// hand-off.
//
// This file is a member of BOTH the App and GlanceWidgetsExtension targets.
public enum SharedDataStore {

    // Declared in App.entitlements and GlanceWidgets.entitlements, and registered
    // on the App ID in the developer portal. A typo here fails silently — the
    // UserDefaults init returns nil and every read looks like "no data yet" — so
    // `isAvailable` below exists to make that case diagnosable.
    public static let suiteName = "group.com.lastglance"

    private static let keySnapshot = "snapshot"
    // Completions logged from a widget tap, awaiting drain into IndexedDB by the
    // web app on next foreground (an extension can't write IndexedDB itself).
    private static let keyPendingCompletions = "pending_completions"
    // A widget body-tap target ("chore:<syncId>" or "filter:soon"), consumed by
    // the web app on foreground. Note these are the internal token forms the JS
    // router expects, NOT lastglance:// URLs — the URL is mapped to a token
    // before it is stored, exactly as MainActivity does on Android.
    private static let keyDeepLink = "pending_deeplink"
    // Text shared into the app to seed a new chore's name.
    private static let keySharedChore = "pending_shared_chore"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }

    // False when the App Group is missing or misspelled in the entitlements /
    // provisioning profile. Callers surface this rather than rendering an
    // indistinguishable "empty" state.
    public static var isAvailable: Bool { defaults != nil }

    // MARK: - Snapshot

    public static func writeSnapshot(_ json: String) {
        defaults?.set(json, forKey: keySnapshot)
    }

    public static func readSnapshot() -> String? {
        defaults?.string(forKey: keySnapshot)
    }

    // MARK: - Pending completions

    // Append a completion to the durable queue. Nothing is minted here; the
    // caller supplies the sync_id so the later replay through logCompletion is
    // idempotent (the web app dedupes on it).
    public static func appendPendingCompletion(choreSyncId: String, syncId: String, completedAt: String) {
        guard let defaults else { return }
        let entry: [String: String] = [
            "choreSyncId": choreSyncId,
            "syncId": syncId,
            "completedAt": completedAt,
        ]
        var queue = (try? JSONSerialization.jsonObject(
            with: Data((defaults.string(forKey: keyPendingCompletions) ?? "[]").utf8)
        )) as? [[String: String]] ?? []
        queue.append(entry)
        guard let data = try? JSONSerialization.data(withJSONObject: queue),
              let json = String(data: data, encoding: .utf8) else { return }
        defaults.set(json, forKey: keyPendingCompletions)
    }

    // Return the queued completions as a JSON array string and clear the queue.
    public static func readAndClearPendingCompletions() -> String {
        guard let defaults else { return "[]" }
        let raw = defaults.string(forKey: keyPendingCompletions) ?? "[]"
        defaults.removeObject(forKey: keyPendingCompletions)
        return raw
    }

    // MARK: - Deep link

    public static func writePendingDeepLink(_ value: String) {
        defaults?.set(value, forKey: keyDeepLink)
    }

    public static func readAndClearPendingDeepLink() -> String? {
        guard let defaults, let value = defaults.string(forKey: keyDeepLink) else { return nil }
        defaults.removeObject(forKey: keyDeepLink)
        return value
    }

    // MARK: - Shared chore text

    // A QUEUE, not a slot — a lesson taken straight from lifeGLANCE's share
    // extension. Android's single slot is correct there because a share opens
    // the app immediately and drains it on the spot; iOS cannot open the host
    // app from a share extension, so shares pile up until the user next opens
    // lastGLANCE, and a last-write-wins slot would silently drop every share
    // but the most recent. The web side consumes one entry per foreground, so
    // queued names surface across subsequent opens, oldest first.

    public static func appendPendingSharedChore(_ value: String) {
        guard let defaults else { return }
        var queue = defaults.stringArray(forKey: keySharedChore) ?? []
        // Migrate a legacy single-string value written by an older build.
        if queue.isEmpty, let legacy = defaults.string(forKey: keySharedChore) {
            queue = [legacy]
        }
        queue.append(value)
        defaults.set(queue, forKey: keySharedChore)
    }

    // Pop the OLDEST queued name; later entries stay for later foregrounds.
    public static func consumeNextSharedChore() -> String? {
        guard let defaults else { return nil }
        if var queue = defaults.stringArray(forKey: keySharedChore) {
            guard !queue.isEmpty else {
                defaults.removeObject(forKey: keySharedChore)
                return nil
            }
            let next = queue.removeFirst()
            if queue.isEmpty {
                defaults.removeObject(forKey: keySharedChore)
            } else {
                defaults.set(queue, forKey: keySharedChore)
            }
            return next
        }
        // Legacy single-string value from an older build: consume it whole.
        if let legacy = defaults.string(forKey: keySharedChore) {
            defaults.removeObject(forKey: keySharedChore)
            return legacy
        }
        return nil
    }
}
