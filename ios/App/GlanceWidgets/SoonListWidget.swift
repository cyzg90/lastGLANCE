import SwiftUI
import WidgetKit

// Phase 2: the "Soon" list widget — the chores aged into the amber/red zone,
// most-overdue first, each with one-tap Done. The iOS counterpart of
// SoonListWidget.kt; row anatomy, colours and type sizes mirror the Glance
// rows so the platforms read as one product.
//
// One structural difference from Android: Glance lists scroll, WidgetKit
// widgets never do. So the row count is fixed per family and a "+N more" line
// stands in for the tail rather than pretending it is not there.

private func rowCapacity(_ family: WidgetFamily) -> Int {
    family == .systemLarge ? 9 : 4
}

// The one-tap Done chip, shared by the list rows and the single-chore widget.
// Runs CompleteChoreIntent in-process — the widget updates immediately, offline,
// and the app replays the queued completion on next foreground.
struct DoneButton: View {
    let choreSyncId: String
    var compact = true

    var body: some View {
        Button(intent: CompleteChoreIntent(choreSyncId: choreSyncId)) {
            Text("Done")
                .font(.system(size: compact ? 12 : 13, weight: .medium))
                .foregroundStyle(.white)
                .padding(.horizontal, compact ? 10 : 12)
                .padding(.vertical, compact ? 5 : 6)
                .background(Color(hexString: "#22c55e"))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}

// One chore as a list row: recency bar, tinted icon, name over elapsed text,
// Done. Same anatomy as ChoreListRow in the Kotlin widget (bar 5x26 r2, icon
// 18, name 14 medium, elapsed 11).
struct ChoreRowView: View {
    let chore: SnapshotChore

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(chore.recencyColor)
                .frame(width: 5, height: 26)
            if let icon = chore.icon {
                LucideIconView(name: icon, color: chore.recencyColor, size: 18)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(chore.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Text(chore.elapsedLabel)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            DoneButton(choreSyncId: chore.syncId)
        }
    }
}

struct SoonListWidgetView: View {
    var entry: SnapshotEntry

    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            if let problem = entry.problem {
                SnapshotProblemView(message: problem)
            } else {
                content
            }
        }
        .containerBackground(for: .widget) {
            Color(uiColor: .systemBackground)
        }
    }

    private var content: some View {
        let capacity = rowCapacity(family)
        let all = entry.snapshot.soonList(limit: 100)
        let shown = Array(all.prefix(capacity))
        let hidden = all.count - shown.count

        return VStack(alignment: .leading, spacing: 0) {
            Text("SOON")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.secondary)
                .padding(.bottom, 6)

            if shown.isEmpty {
                Spacer(minLength: 0)
                Text("All caught up")
                    .font(.system(size: 14))
                    .foregroundStyle(.primary)
                Spacer(minLength: 0)
                Wordmark(size: 16)
            } else {
                ForEach(shown, id: \.syncId) { chore in
                    ChoreRowView(chore: chore)
                        .padding(.vertical, 4)
                }
                if hidden > 0 {
                    Text("+\(hidden) more")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .padding(.top, 2)
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct SoonListWidget: Widget {
    let kind = "SoonListWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            SoonListWidgetView(entry: entry)
        }
        .configurationDisplayName("Soon")
        .description("Chores that are due soon or overdue, with one-tap Done.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
