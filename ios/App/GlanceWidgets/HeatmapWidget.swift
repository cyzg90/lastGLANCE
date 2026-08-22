import SwiftUI
import WidgetKit

// GitHub-style contribution heatmap of completion activity — the iOS counterpart
// of glance/HeatmapWidget.kt. Renders purely from the App-Group snapshot the web
// app pushes; it never touches the database.
//
// Colour scale and bucket thresholds are copied from the Android widget on
// purpose: the two platforms should read as the same product, and the buckets are
// part of how the data is understood, not a styling choice.
//
// Two sizes, two jobs:
//   - systemMedium    26 weeks, bare grid. The half-year "am I keeping up" view.
//   - systemExtraLarge 52 weeks, with month/weekday labels and a legend. The
//                     full-year review. iPad only — WidgetKit has never offered
//                     an extra-large family on iPhone.
//
// systemLarge is deliberately absent. A 52x7 grid of square cells is ~7.4:1, so
// in a square widget it renders as a band with two thirds of the height empty,
// with nothing worth putting there. Extra-large is ~2:1 and carries it.

private let daysPerWeek = 7

private let mediumWeeks = 26
private let extraLargeWeeks = 52

// Cell 11pt on a 3pt gap, as on Android. Expressed as ratios so the grid scales
// to whatever width the family gives us instead of being pinned to Android's
// density-derived pixel sizes. One "unit" is cell + gap.
private let cellRatio = 11.0 / 14.0
private let gapRatio = 3.0 / 14.0

// Label gutters, also in units, so they scale with the cells. The left gutter
// holds "Mon"/"Wed"/"Fri"; the top strip holds month abbreviations.
private let weekdayGutterUnits = 2.4
private let monthStripUnits = 1.3

private let brandGreen = Color(red: 0x3D / 255, green: 0xDC / 255, blue: 0x84 / 255)

private func hex(_ value: UInt32) -> Color {
    Color(
        red: Double((value >> 16) & 0xFF) / 255,
        green: Double((value >> 8) & 0xFF) / 255,
        blue: Double(value & 0xFF) / 255
    )
}

// File scope so the grid and the legend cannot drift apart. `dark` only affects
// the empty cell, exactly as the Android widget's UI_MODE_NIGHT branch does; the
// filled scale is identical in both appearances.
private func heatColor(_ count: Int, dark: Bool) -> Color {
    switch count {
    case ..<1: return dark ? hex(0x2D333B) : hex(0xEBEDF0)
    case 1: return hex(0x9BE9A8)
    case 2...3: return hex(0x40C463)
    case 4...5: return hex(0x30A14E)
    default: return hex(0x216E39)
    }
}

// The five swatches the legend shows, low to high. Index 0 is the empty cell.
private let legendCounts = [0, 1, 2, 4, 6]

// The snapshot's heatmap keys are local dates formatted by dayjs in the WebView,
// so every reader here must use the same calendar and time zone. en_US_POSIX
// keeps the format fixed regardless of the user's locale settings. Shared by the
// grid and the stats so the two can never key the map differently.
private let heatmapKeyFormatter: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f
}()

// Oldest visible day: back to this week's Sunday, then back to the first visible
// week. Matches the Android walk exactly so both grids show the same window and
// the same week alignment. File scope because the stats read the same window the
// grid draws — a total that disagreed with the cells on screen would be worse
// than no total at all.
private func gridStartDate(weeks: Int) -> Date {
    let calendar = Calendar.current
    let today = calendar.startOfDay(for: Date())
    let weekday = calendar.component(.weekday, from: today) // 1 = Sunday
    let thisSunday = calendar.date(byAdding: .day, value: -(weekday - 1), to: today) ?? today
    return calendar.date(byAdding: .day, value: -(weeks - 1) * 7, to: thisSunday) ?? thisSunday
}

// Summary of the drawn window, for the extra-large stats row. Cheap: the heatmap
// is a few hundred entries at most.
private struct HeatmapStats {
    let completions: Int
    let activeDays: Int
    let streak: Int

    init(heatmap: [String: Int], weeks: Int) {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let start = gridStartDate(weeks: weeks)

        var total = 0
        var active = 0
        var day = start
        while day <= today {
            let count = heatmap[heatmapKeyFormatter.string(from: day)] ?? 0
            if count > 0 {
                total += count
                active += 1
            }
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }
        completions = total
        activeDays = active

        // Streak counts consecutive days with at least one completion, ending
        // today. If today is still empty the streak is measured to yesterday
        // instead — at 9am you have not broken a streak, you just have not logged
        // anything yet, and zeroing it then would be a lie the user would resent.
        var cursor = today
        if (heatmap[heatmapKeyFormatter.string(from: today)] ?? 0) == 0 {
            cursor = calendar.date(byAdding: .day, value: -1, to: today) ?? today
        }
        var run = 0
        while cursor >= start, (heatmap[heatmapKeyFormatter.string(from: cursor)] ?? 0) > 0 {
            run += 1
            guard let prev = calendar.date(byAdding: .day, value: -1, to: cursor) else { break }
            cursor = prev
        }
        streak = run
    }
}

// MARK: - Timeline

struct HeatmapEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
    // Non-nil when there is nothing to draw and we know why. Rendered in place
    // of the grid so the failure names itself instead of looking like a widget
    // that never finished loading.
    let problem: String?

    init(date: Date, snapshot: WidgetSnapshot, problem: String? = nil) {
        self.date = date
        self.snapshot = snapshot
        self.problem = problem
    }

    init(date: Date, load: SnapshotLoad) {
        self.init(date: date, snapshot: load.snapshot, problem: load.problem)
    }
}

struct HeatmapProvider: TimelineProvider {

    func placeholder(in context: Context) -> HeatmapEntry {
        HeatmapEntry(date: Date(), snapshot: WidgetSnapshot())
    }

    func getSnapshot(in context: Context, completion: @escaping (HeatmapEntry) -> Void) {
        completion(HeatmapEntry(date: Date(), load: SnapshotLoad.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HeatmapEntry>) -> Void) {
        let now = Date()
        let entry = HeatmapEntry(date: now, load: SnapshotLoad.read())

        // WidgetKit is not a live process, so the only two things that can change
        // what this widget should show are (a) the app pushing a new snapshot,
        // which calls reloadAllTimelines directly, and (b) the date rolling over,
        // which shifts the whole grid by one column. Only (b) needs a scheduled
        // refresh, so ask for exactly one, at the next local midnight.
        //
        // Computed by adding a day to the start of today, rather than with
        // Calendar.nextDate(after:matching:matchingPolicy:), which is what this
        // used to call. Direct arithmetic over a search API is the smaller,
        // clearer thing to do here and that is the whole reason it stays.
        //
        // It is NOT a bug fix, despite what the commit that introduced it said:
        // the widget was blank because of a stale WidgetKit extension cache, and
        // a device reboot fixed it. nextDate had been in this method since the
        // widget was written and had worked fine throughout.
        let calendar = Calendar.current
        var refresh = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))
            ?? now.addingTimeInterval(3600)
        // A refresh date must be in the future or WidgetKit has nothing to
        // schedule; belt-and-braces against a DST edge or a nil from the calendar.
        if refresh <= now { refresh = now.addingTimeInterval(3600) }

        completion(Timeline(entries: [entry], policy: .after(refresh)))
    }
}

// MARK: - Grid

private struct HeatmapGrid: View {
    let weeks: Int
    let heatmap: [String: Int]
    let showsLabels: Bool

    // Month abbreviations follow the user's locale — unlike the data keys, these
    // are read by a human. The same formatter is the source of the weekday
    // symbols: DateFormatter.shortWeekdaySymbols is always Sunday-first, which is
    // the row order this grid walks in.
    private static let monthFormatter: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("MMM")
        return f
    }()

    // Width and height in units, including the label gutters when shown, so the
    // whole labelled block scales as one piece inside aspectRatio(_:contentMode:).
    private var aspect: Double {
        let across = (showsLabels ? weekdayGutterUnits : 0) + Double(weeks) - gapRatio
        let down = (showsLabels ? monthStripUnits : 0) + Double(daysPerWeek) - gapRatio
        return across / down
    }

    var body: some View {
        HeatmapCanvas(
            weeks: weeks,
            heatmap: heatmap,
            showsLabels: showsLabels,
            startDate: gridStartDate(weeks: weeks),
            keyFormatter: heatmapKeyFormatter,
            monthFormatter: Self.monthFormatter
        )
        .aspectRatio(aspect, contentMode: .fit)
    }
}

private struct HeatmapCanvas: View {
    let weeks: Int
    let heatmap: [String: Int]
    let showsLabels: Bool
    let startDate: Date
    let keyFormatter: DateFormatter
    let monthFormatter: DateFormatter

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Canvas { context, size in
            let dark = colorScheme == .dark
            let calendar = Calendar.current

            // Solve size.width = gutter + weeks*unit - gap for unit, where both
            // the gutter and the gap are themselves expressed in units.
            let across = (showsLabels ? weekdayGutterUnits : 0) + Double(weeks) - gapRatio
            let unit = size.width / across
            let cell = unit * cellRatio
            let gap = unit * gapRatio
            let radius = cell * 0.22
            let originX = showsLabels ? weekdayGutterUnits * unit : 0
            let originY = showsLabels ? monthStripUnits * unit : 0

            // Cells. Walk day by day in column-major order, which is also the
            // order the dates advance, so one cursor covers the whole grid.
            var day = startDate
            for col in 0..<weeks {
                for row in 0..<daysPerWeek {
                    let count = heatmap[heatmapKeyFormatter.string(from: day)] ?? 0
                    let rect = CGRect(
                        x: originX + Double(col) * (cell + gap),
                        y: originY + Double(row) * (cell + gap),
                        width: cell,
                        height: cell
                    )
                    context.fill(
                        Path(roundedRect: rect, cornerRadius: radius),
                        with: .color(heatColor(count, dark: dark))
                    )
                    day = calendar.date(byAdding: .day, value: 1, to: day) ?? day
                }
            }

            guard showsLabels else { return }
            let labelFont = Font.system(size: unit * 0.78)

            // Month labels: drawn at the first column of each new month, the way
            // GitHub does it, plus the leftmost column so the oldest (partial)
            // month is not left anonymous. Two guards keep them readable — never
            // within three columns of the previous label, and never so close to
            // the right edge that the text would overhang the grid.
            var lastMonth = -1
            var lastLabelCol = -99
            for col in 0..<weeks {
                guard let columnStart = calendar.date(byAdding: .day, value: col * 7, to: startDate)
                else { continue }
                let month = calendar.component(.month, from: columnStart)
                defer { lastMonth = month }
                guard month != lastMonth else { continue }
                guard col - lastLabelCol >= 3, col <= weeks - 3 else { continue }
                lastLabelCol = col
                context.draw(
                    Text(monthFormatter.string(from: columnStart))
                        .font(labelFont)
                        .foregroundStyle(.secondary),
                    at: CGPoint(x: originX + Double(col) * (cell + gap), y: originY - gap),
                    anchor: .bottomLeading
                )
            }

            // Weekday labels on the alternating rows GitHub labels, right-aligned
            // into the gutter so they sit just off the first column. Row 0 is
            // Sunday (the grid starts on one) and shortWeekdaySymbols is
            // Sunday-first, so the row index indexes the array directly.
            let weekdayNames = monthFormatter.shortWeekdaySymbols ?? []
            for row in [1, 3, 5] where row < weekdayNames.count {
                let name = weekdayNames[row]
                context.draw(
                    Text(name)
                        .font(labelFont)
                        .foregroundStyle(.secondary),
                    at: CGPoint(
                        x: originX - gap * 2,
                        y: originY + Double(row) * (cell + gap) + cell / 2
                    ),
                    anchor: .trailing
                )
            }
        }
    }
}

// MARK: - Legend

private struct HeatmapLegend: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: 4) {
            Text("Less")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
            ForEach(legendCounts, id: \.self) { count in
                RoundedRectangle(cornerRadius: 2)
                    .fill(heatColor(count, dark: colorScheme == .dark))
                    .frame(width: 10, height: 10)
            }
            Text("More")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
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

// One figure and its caption. Deliberately lastGLANCE's own idiom — system fonts
// and semantic colours — rather than lifeGLANCE's monospaced palette, since this
// sits directly under a grid already drawn in system colours.
private struct StatTile: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.primary)
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
        }
        .lineLimit(1)
    }
}

private func plural(_ n: Int, _ singular: String, _ plural: String) -> String {
    n == 1 ? singular : plural
}

private struct Wordmark: View {
    let size: Double

    var body: some View {
        HStack(spacing: 0) {
            Text("last")
                .font(.system(size: size, weight: .bold))
                .foregroundStyle(.primary)
            Text("GLANCE")
                .font(.system(size: size, weight: .bold))
                .italic()
                .foregroundStyle(brandGreen)
        }
    }
}

struct HeatmapWidgetView: View {
    var entry: HeatmapEntry

    @Environment(\.widgetFamily) private var family

    private var stat: String {
        statText(overdue: entry.snapshot.counts.overdue, soon: entry.snapshot.counts.soon)
    }

    var body: some View {
        Group {
            if let problem = entry.problem {
                diagnostic(problem)
            } else if family == .systemExtraLarge {
                extraLarge
            } else {
                medium
            }
        }
        .containerBackground(for: .widget) {
            Color(uiColor: .systemBackground)
        }
    }

    // Shown instead of an all-empty grid when the snapshot could not be read.
    // An empty grid is a legitimate render (a user with no completions yet), so
    // it must not double as the error state.
    private func diagnostic(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Spacer(minLength: 0)
            Wordmark(size: family == .systemExtraLarge ? 26 : 20)
            Text(message)
                .font(.system(size: family == .systemExtraLarge ? 15 : 13))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // Unchanged from the original single-size widget. The half-year grid at this
    // width lands around 10pt cells and fills the family comfortably, so it gets
    // no labels and no legend — the furniture would cost more than it explains.
    private var medium: some View {
        VStack(alignment: .leading, spacing: 6) {
            HeatmapGrid(weeks: mediumWeeks, heatmap: entry.snapshot.heatmap, showsLabels: false)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            HStack(spacing: 0) {
                Wordmark(size: 20)
                Spacer(minLength: 8)
                Text(stat)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
    }

    // A 52-week band is ~7.4:1 and this family is ~2:1, so the grid cannot fill
    // the height by stretching — the cells have to stay square and there are
    // exactly seven rows. Instead the leftover height carries content that only
    // appears at this size: GitHub's own furniture (month and weekday labels, a
    // legend) plus a summary of the window on screen. That mirrors lifeGLANCE's
    // TimelineStripView, which likewise shows a caption row above medium.
    private var extraLarge: some View {
        let stats = HeatmapStats(heatmap: entry.snapshot.heatmap, weeks: extraLargeWeeks)

        return VStack(alignment: .leading, spacing: 12) {
            Spacer(minLength: 0)

            HeatmapGrid(weeks: extraLargeWeeks, heatmap: entry.snapshot.heatmap, showsLabels: true)
                .frame(maxWidth: .infinity)

            HStack(spacing: 0) {
                Spacer(minLength: 0)
                HeatmapLegend()
            }

            Spacer(minLength: 0)

            // Figures describe exactly the window drawn above, not all of
            // history, so nothing here can contradict the cells on screen.
            HStack(alignment: .top, spacing: 28) {
                StatTile(
                    value: "\(stats.completions)",
                    label: plural(stats.completions, "completion", "completions")
                )
                StatTile(
                    value: "\(stats.activeDays)",
                    label: plural(stats.activeDays, "active day", "active days")
                )
                StatTile(value: "\(stats.streak)", label: "day streak")
                Spacer(minLength: 0)
            }

            Spacer(minLength: 0)

            HStack(spacing: 0) {
                Wordmark(size: 26)
                Spacer(minLength: 12)
                Text(stat)
                    .font(.system(size: 16))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
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
        .supportedFamilies([.systemMedium, .systemExtraLarge])
    }
}
