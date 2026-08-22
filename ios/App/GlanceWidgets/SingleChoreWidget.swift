import SwiftUI
import WidgetKit
import AppIntents

// Phase 2: the configurable single-chore widget — the iOS counterpart of
// SingleChoreWidget.kt + SingleChoreConfigActivity.kt. Where Android needs a
// whole config Activity, WidgetKit gets configuration for free from an
// AppIntentConfiguration: long-press → Edit Widget → pick a chore. Unconfigured
// it tracks the most-overdue chore, exactly like the Android tile's fallback.

// A chore as the configuration UI sees it. The identifier is the sync_id — the
// only name for a chore that is stable across devices and edits.
struct ChoreEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Chore"
    static let defaultQuery = ChoreEntityQuery()

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct ChoreEntityQuery: EntityQuery {
    // Both lookups read the App-Group snapshot — the configuration sheet runs in
    // the widget extension, where the snapshot is the only data there is.
    func entities(for identifiers: [String]) async throws -> [ChoreEntity] {
        let snapshot = SnapshotLoad.read().snapshot
        return identifiers.compactMap { id in
            snapshot.chore(bySyncId: id).map { ChoreEntity(id: $0.syncId, name: $0.name) }
        }
    }

    func suggestedEntities() async throws -> [ChoreEntity] {
        SnapshotLoad.read().snapshot.chores
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            .map { ChoreEntity(id: $0.syncId, name: $0.name) }
    }
}

struct SelectChoreIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Choose chore"
    static let description = IntentDescription("Pick the chore this widget tracks.")

    // Optional on purpose: nil means "track whatever is most overdue", the same
    // default a freshly placed Android tile has.
    @Parameter(title: "Chore")
    var chore: ChoreEntity?
}

struct ConfiguredChoreEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
    let problem: String?
    let configuredSyncId: String?
}

struct ConfiguredChoreProvider: AppIntentTimelineProvider {

    func placeholder(in context: Context) -> ConfiguredChoreEntry {
        ConfiguredChoreEntry(date: Date(), snapshot: WidgetSnapshot(), problem: nil, configuredSyncId: nil)
    }

    func snapshot(for configuration: SelectChoreIntent, in context: Context) async -> ConfiguredChoreEntry {
        entry(for: configuration)
    }

    func timeline(for configuration: SelectChoreIntent, in context: Context) async -> Timeline<ConfiguredChoreEntry> {
        // Same refresh contract as SnapshotProvider: the app's snapshot pushes
        // reload everything, so the only scheduled refresh is the day rollover.
        let now = Date()
        let calendar = Calendar.current
        var refresh = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))
            ?? now.addingTimeInterval(3600)
        if refresh <= now { refresh = now.addingTimeInterval(3600) }
        return Timeline(entries: [entry(for: configuration)], policy: .after(refresh))
    }

    private func entry(for configuration: SelectChoreIntent) -> ConfiguredChoreEntry {
        let load = SnapshotLoad.read()
        return ConfiguredChoreEntry(
            date: Date(),
            snapshot: load.snapshot,
            problem: load.problem,
            configuredSyncId: configuration.chore?.id
        )
    }
}

struct SingleChoreWidgetView: View {
    var entry: ConfiguredChoreEntry

    @Environment(\.widgetFamily) private var family

    // A configured chore wins; else fall back to most-overdue — the Android
    // rule. A configured chore that has vanished from the snapshot (deleted,
    // or filtered out by multi-user "Mine") intentionally does NOT fall back:
    // showing some other chore under a widget the user pinned to a specific
    // one would be worse than showing the caught-up state.
    private var chore: SnapshotChore? {
        if let id = entry.configuredSyncId {
            return entry.snapshot.chore(bySyncId: id)
        }
        return entry.snapshot.mostOverdue
    }

    var body: some View {
        Group {
            if let problem = entry.problem {
                SnapshotProblemView(message: problem)
            } else if let chore {
                if family == .systemSmall {
                    small(chore)
                } else {
                    medium(chore)
                }
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    Wordmark(size: 15)
                    Text("All caught up")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
        }
        .containerBackground(for: .widget) {
            Color(uiColor: .systemBackground)
        }
    }

    // The Android tile's row, at its sizes: bar 6x36 r3, icon 22, name 15 bold,
    // elapsed 12, larger Done chip.
    private func medium(_ chore: SnapshotChore) -> some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 3)
                .fill(chore.recencyColor)
                .frame(width: 6, height: 36)
            if let icon = chore.icon {
                LucideIconView(name: icon, color: chore.recencyColor, size: 22)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(chore.name)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Text(chore.elapsedLabel)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            DoneButton(choreSyncId: chore.syncId, compact: false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    // systemSmall has no Android analogue (tiles have one shape); a vertical
    // arrangement of the same parts, with Done full-width at the bottom.
    private func small(_ chore: SnapshotChore) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(chore.recencyColor)
                    .frame(width: 6, height: 28)
                if let icon = chore.icon {
                    LucideIconView(name: icon, color: chore.recencyColor, size: 22)
                }
                Spacer(minLength: 0)
            }
            Text(chore.name)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.primary)
                .lineLimit(2)
            Text(chore.elapsedLabel)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Button(intent: CompleteChoreIntent(choreSyncId: chore.syncId)) {
                Text("Done")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .background(Color(hexString: "#22c55e"))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct SingleChoreWidget: Widget {
    let kind = "SingleChoreWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: SelectChoreIntent.self,
            provider: ConfiguredChoreProvider()
        ) { entry in
            SingleChoreWidgetView(entry: entry)
        }
        .configurationDisplayName("Chore")
        .description("One chore and how long it has been, with one-tap Done. Edit the widget to pick which.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
