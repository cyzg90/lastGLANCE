import SwiftUI
import WidgetKit

// The one TimelineProvider every lastGLANCE widget shares. All of them render
// from the same App-Group snapshot and refresh on the same two signals — the
// app pushing a new snapshot (reloadAllTimelines from the WidgetBridge plugin)
// and the local date rolling over — so there is nothing widget-specific to
// provide. Moved out of HeatmapWidget.swift when the Phase 2 widgets arrived.

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
    // Non-nil when there is nothing to draw and we know why. Rendered in place
    // of the widget's content so the failure names itself instead of looking
    // like a widget that never finished loading.
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

struct SnapshotProvider: TimelineProvider {

    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), snapshot: WidgetSnapshot())
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: Date(), load: SnapshotLoad.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let now = Date()
        let entry = SnapshotEntry(date: now, load: SnapshotLoad.read())

        // WidgetKit is not a live process, so the only two things that can change
        // what a widget should show are (a) the app pushing a new snapshot,
        // which calls reloadAllTimelines directly, and (b) the date rolling over,
        // which shifts the heatmap by a column and every "Xd ago" by a day. Only
        // (b) needs a scheduled refresh, so ask for exactly one, at the next
        // local midnight.
        //
        // Computed by adding a day to the start of today, NOT with
        // Calendar.nextDate(after:matching:matchingPolicy:) — a search API is
        // more machinery than "next midnight" needs, and direct arithmetic has
        // nothing in it to go wrong.
        let calendar = Calendar.current
        var refresh = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))
            ?? now.addingTimeInterval(3600)
        // A refresh date must be in the future or WidgetKit has nothing to
        // schedule; belt-and-braces against a DST edge or a nil from the calendar.
        if refresh <= now { refresh = now.addingTimeInterval(3600) }

        completion(Timeline(entries: [entry], policy: .after(refresh)))
    }
}

// Shown instead of a widget's content when the snapshot could not be read. An
// empty widget is a legitimate render (a user with no data yet), so it must
// not double as the error state.
struct SnapshotProblemView: View {
    let message: String
    var large = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Spacer(minLength: 0)
            Wordmark(size: large ? 26 : 20)
            Text(message)
                .font(.system(size: large ? 15 : 13))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// The lastGLANCE wordmark, shared by every widget's footer and empty state.
struct Wordmark: View {
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

let brandGreen = Color(red: 0x3D / 255, green: 0xDC / 255, blue: 0x84 / 255)
