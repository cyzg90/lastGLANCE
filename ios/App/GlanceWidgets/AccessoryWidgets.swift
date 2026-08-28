import SwiftUI
import WidgetKit
import AppIntents

// Lock Screen widget + Control Center control — the closest iOS analogues of
// Android's two Quick Settings tiles (tiles/QsTiles.kt: at-a-glance status and
// one-tap add). The plan's stretch goal.
//
// Accessory families render in the system's tinted/monochrome style, so there
// are no brand colours here — hierarchy comes from type weight alone, and the
// system applies its own vibrancy. Content stays to the counts and the top
// chore: a Lock Screen glance earns its place by being readable in under a
// second.

// MARK: - Lock Screen widget

struct AccessoryStatusView: View {
    var entry: SnapshotEntry

    @Environment(\.widgetFamily) private var family

    private var overdue: Int { entry.snapshot.counts.overdue }
    private var soon: Int { entry.snapshot.counts.soon }

    var body: some View {
        Group {
            switch family {
            case .accessoryCircular: circular
            case .accessoryInline: inline
            default: rectangular
            }
        }
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(soonURL)
    }

    // A count with a caption; AccessoryWidgetBackground gives the standard
    // frosted disc the system uses for numeric complications.
    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text("\(overdue)")
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                Text("due")
                    .font(.system(size: 10))
            }
        }
    }

    private var inline: some View {
        // One line, no layout to control. ViewThatFits picks the longer wording
        // when the slot allows it (above the clock the slot is generous, but
        // its width varies by device and date length).
        ViewThatFits {
            Text("lastGLANCE · \(overdue) overdue, \(soon) soon")
            Text("\(overdue) overdue · \(soon) soon")
            Text("\(overdue) overdue")
        }
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("lastGLANCE")
                .font(.system(size: 12, weight: .bold))
            if let top = entry.snapshot.mostOverdue, overdue + soon > 0 {
                Text(top.name)
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
                Text("\(top.elapsedLabel) · \(overdue) overdue")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            } else {
                Text("All caught up")
                    .font(.system(size: 14))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AccessoryStatusWidget: Widget {
    let kind = "AccessoryStatusWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            AccessoryStatusView(entry: entry)
        }
        .configurationDisplayName("Overdue at a glance")
        .description("How many chores need attention, on your Lock Screen.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// The Control Center control that used to live here now sits in
// App/Shared/AddChoreControl.swift: it has to compile into the app target
// as well as this one, and the accessory widget above cannot (it depends on
// SnapshotProvider/SnapshotEntry, which are extension-only).
