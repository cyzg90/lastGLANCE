import SwiftUI
import WidgetKit

// A static one-tap surface that opens the app straight into the new-chore form
// — the iOS counterpart of AddChoreWidget.kt, and the same composition: a green
// CirclePlus next to a bold "Add chore", centered. No snapshot dependency at
// all; the only thing this widget does is carry its deep link.

private let addGreen = Color(hexString: "#22c55e")!

struct AddChoreWidgetView: View {
    var body: some View {
        HStack(spacing: 8) {
            LucideIconView(name: "CirclePlus", color: addGreen, size: 22)
            Text("Add chore")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(for: .widget) {
            Color(uiColor: .systemBackground)
        }
        .widgetURL(URL(string: "lastglance://action/add"))
    }
}

// A provider in name only: the content is static, so one entry with a
// never-practically-reached refresh is all WidgetKit needs.
struct AddChoreProvider: TimelineProvider {
    struct Entry: TimelineEntry { let date: Date }

    func placeholder(in context: Context) -> Entry { Entry(date: Date()) }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: Date())], policy: .never))
    }
}

struct AddChoreWidget: Widget {
    let kind = "AddChoreWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AddChoreProvider()) { _ in
            AddChoreWidgetView()
        }
        .configurationDisplayName("Add chore")
        .description("A one-tap shortcut to add a new chore.")
        .supportedFamilies([.systemSmall])
    }
}
