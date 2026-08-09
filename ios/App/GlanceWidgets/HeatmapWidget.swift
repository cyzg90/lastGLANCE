import SwiftUI
import WidgetKit

// GitHub-style contribution heatmap of completion activity — the iOS counterpart
// of glance/HeatmapWidget.kt. Renders purely from the App-Group snapshot the web
// app pushes; it never touches the database.
//
// Geometry, colour scale and bucket thresholds are copied from the Android widget
// on purpose: the two platforms should read as the same product, and the buckets
// are part of how the data is understood, not a styling choice.

private let weeks = 26
private let daysPerWeek = 7

// Cell 11pt on a 3pt gap, as on Android. Expressed as ratios so the grid can be
// scaled to whatever width the widget family gives us instead of being pinned to
// Android's density-derived pixel sizes.
private let cellRatio = 11.0 / 14.0
private let gapRatio = 3.0 / 14.0

// Width and height in "units" (one unit = cell + gap), minus the trailing gap.
private let gridAspect =
    (Double(weeks) - gapRatio) / (Double(daysPerWeek) - gapRatio)

private let brandGreen = Color(red: 0x3D / 255, green: 0xDC / 255, blue: 0x84 / 255)

private func hex(_ value: UInt32) -> Color {
    Color(
        red: Double((value >> 16) & 0xFF) / 255,
        green: Double((value >> 8) & 0xFF) / 255,
        blue: Double(value & 0xFF) / 255
    )
}

// MARK: - Timeline

struct HeatmapEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct HeatmapProvider: TimelineProvider {

    func placeholder(in context: Context) -> HeatmapEntry {
        HeatmapEntry(date: Date(), snapshot: WidgetSnapshot())
    }

    func getSnapshot(in context: Context, completion: @escaping (HeatmapEntry) -> Void) {
        completion(HeatmapEntry(date: Date(), snapshot: WidgetSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HeatmapEntry>) -> Void) {
        let entry = HeatmapEntry(date: Date(), snapshot: WidgetSnapshot.load())
        // WidgetKit is not a live process, so the only two things that can change
        // what this widget should show are (a) the app pushing a new snapshot,
        // which calls reloadAllTimelines directly, and (b) the date rolling over,
        // which shifts the whole grid by one column. Only (b) needs a scheduled
        // refresh, so ask for exactly one, at the next local midnight.
        let midnight = Calendar.current.nextDate(
            after: Date(),
            matching: DateComponents(hour: 0, minute: 0, second: 0),
            matchingPolicy: .nextTime
        ) ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [entry], policy: .after(midnight)))
    }
}

// MARK: - Grid

private struct HeatmapGrid: View {
    let heatmap: [String: Int]

    // The keys are local dates formatted by dayjs in the WebView, so the reader
    // must use the same calendar and time zone. en_US_POSIX keeps the format
    // fixed regardless of the user's locale settings.
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    // Oldest visible day: back to this week's Sunday, then back to the first
    // visible week. Matches the Android walk exactly so both grids show the same
    // window and the same week alignment.
    private var startDate: Date {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let weekday = calendar.component(.weekday, from: today) // 1 = Sunday
        let thisSunday = calendar.date(byAdding: .day, value: -(weekday - 1), to: today) ?? today
        return calendar.date(byAdding: .day, value: -(weeks - 1) * 7, to: thisSunday) ?? thisSunday
    }

    private func color(for count: Int, dark: Bool) -> Color {
        switch count {
        case ..<1: return dark ? hex(0x2D333B) : hex(0xEBEDF0)
        case 1: return hex(0x9BE9A8)
        case 2...3: return hex(0x40C463)
        case 4...5: return hex(0x30A14E)
        default: return hex(0x216E39)
        }
    }

    var body: some View {
        // colorScheme drives the empty-cell colour the same way the Android widget
        // reads UI_MODE_NIGHT: the filled scale is identical in both appearances,
        // only the "nothing here" cell changes.
        HeatmapCanvas(heatmap: heatmap, startDate: startDate, formatter: Self.formatter, color: color)
            .aspectRatio(gridAspect, contentMode: .fit)
    }
}

private struct HeatmapCanvas: View {
    let heatmap: [String: Int]
    let startDate: Date
    let formatter: DateFormatter
    let color: (Int, Bool) -> Color

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Canvas { context, size in
            let dark = colorScheme == .dark
            // Solve size.width = weeks*unit - gap for unit, where gap = unit*gapRatio.
            let unit = size.width / (Double(weeks) - gapRatio)
            let cell = unit * cellRatio
            let gap = unit * gapRatio
            let radius = cell * 0.22
            let calendar = Calendar.current

            var day = startDate
            for col in 0..<weeks {
                for row in 0..<daysPerWeek {
                    let count = heatmap[formatter.string(from: day)] ?? 0
                    let rect = CGRect(
                        x: Double(col) * (cell + gap),
                        y: Double(row) * (cell + gap),
                        width: cell,
                        height: cell
                    )
                    context.fill(
                        Path(roundedRect: rect, cornerRadius: radius),
                        with: .color(color(count, dark))
                    )
                    day = calendar.date(byAdding: .day, value: 1, to: day) ?? day
                }
            }
        }
    }
}

// MARK: - View

private func statText(overdue: Int, soon: Int) -> String {
    switch (overdue, soon) {
    case let (o, s) where o > 0 && s > 0: return "\(o) overdue · \(s) soon"
    case let (o, _) where o > 0: return "\(o) overdue"
    case let (_, s) where s > 0: return "\(s) soon"
    default: return "All caught up"
    }
}

struct HeatmapWidgetView: View {
    var entry: HeatmapEntry

    @Environment(\.widgetFamily) private var family

    // Android drops the stat below ~340dp so the wordmark cannot clip. The
    // WidgetKit equivalent is the family: systemSmall is far too narrow for a
    // 26-week grid plus a stat, so it keeps the wordmark alone.
    private var showStat: Bool { family != .systemSmall }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HeatmapGrid(heatmap: entry.snapshot.heatmap)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            HStack(spacing: 0) {
                Text("last")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.primary)
                Text("GLANCE")
                    .font(.system(size: 20, weight: .bold))
                    .italic()
                    .foregroundStyle(brandGreen)
                if showStat {
                    Spacer(minLength: 8)
                    Text(statText(overdue: entry.snapshot.counts.overdue,
                                  soon: entry.snapshot.counts.soon))
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
        }
        .containerBackground(for: .widget) {
            Color(uiColor: .systemBackground)
        }
    }
}

struct HeatmapWidget: Widget {
    let kind = "HeatmapWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: HeatmapProvider()) { entry in
            HeatmapWidgetView(entry: entry)
        }
        .configurationDisplayName("Activity")
        .description("Your completion history at a glance.")
        // No widgetURL yet: lastglance:// is not declared in Info.plist until
        // Phase 3, so a body tap falls back to WidgetKit's default of opening the
        // app. Phase 3 adds the URL and the "open Soon" routing the Android
        // widget has.
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
