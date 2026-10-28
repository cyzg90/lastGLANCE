import SwiftUI
import WidgetKit

// The People widgets (docs: the People spec, Widgets), the iOS counterparts of
// ReachOutWidget.kt and ComingUpWidget.kt, plus the Lock Screen next-date
// widget Android has no slot for. They draw the snapshot's `people` block,
// whose words the app has already put in its own language; only the widget
// gallery names and descriptions below are localized here.
//
// Dates arrive as local days and are counted at render time, so "tomorrow"
// is right after the midnight refresh SnapshotProvider already schedules.

let peopleURL = URL(string: "lastglance://people")!

func personURL(_ syncId: String) -> URL {
    URL(string: "lastglance://person/\(syncId)") ?? peopleURL
}

func logPersonURL(_ syncId: String) -> URL {
    URL(string: "lastglance://log/\(syncId)") ?? peopleURL
}

private let soonPink = Color(hexString: "#f472b6")!

// A Coming up date with its day count worked out for today. Dates the snapshot
// still lists but that have passed are dropped.
struct UpcomingPeopleDate {
    let date: PeopleDate
    let on: Date
    let daysUntil: Int

    static func list(_ people: PeopleSnapshot, now: Date = Date()) -> [UpcomingPeopleDate] {
        let calendar = Calendar.current
        let parser = DateFormatter()
        parser.calendar = calendar
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = calendar.timeZone
        parser.dateFormat = "yyyy-MM-dd"
        let today = calendar.startOfDay(for: now)
        return people.comingUp.compactMap { d in
            guard let on = parser.date(from: d.on) else { return nil }
            let days = calendar.dateComponents([.day], from: today, to: calendar.startOfDay(for: on)).day ?? -1
            return days < 0 ? nil : UpcomingPeopleDate(date: d, on: on, daysUntil: days)
        }
    }
}

// MARK: - Reach out

struct ReachOutRowView: View {
    let row: PeopleReachOut

    var body: some View {
        // The whole row opens quick-log for the person.
        Link(destination: logPersonURL(row.syncId)) {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(hexString: row.color) ?? soonPink)
                    .frame(width: 5, height: 26)
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.name)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(row.detail)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
        }
    }
}

struct ReachOutWidgetView: View {
    var entry: SnapshotEntry

    private var people: PeopleSnapshot { entry.snapshot.people }

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
        .widgetURL(peopleURL)
    }

    private var content: some View {
        let rows = people.reachOut
        return Group {
            if rows.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    Spacer(minLength: 0)
                    Text(people.labels.reachOutEmpty)
                        .font(.system(size: 14))
                        .foregroundStyle(.primary)
                    Spacer(minLength: 0)
                    Wordmark(size: 16)
                }
            } else {
                // As in SoonListWidget: measured candidates, most rows first.
                ViewThatFits(in: .vertical) {
                    candidate(rows, 5)
                    candidate(rows, 4)
                    candidate(rows, 3)
                    candidate(rows, 2)
                    candidate(rows, 1)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var header: some View {
        Text(people.labels.reachOut.uppercased())
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(.secondary)
            .padding(.bottom, 4)
    }

    private func candidate(_ rows: [PeopleReachOut], _ count: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ForEach(Array(rows.prefix(count)), id: \.syncId) { row in
                ReachOutRowView(row: row)
                    .padding(.vertical, 3)
            }
        }
    }
}

struct ReachOutWidget: Widget {
    let kind = "ReachOutWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            ReachOutWidgetView(entry: entry)
        }
        .configurationDisplayName("Reach out")
        .description("Who you're due to get in touch with. Tap someone to log a contact.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

// MARK: - Coming up

struct ComingUpRowView: View {
    let item: UpcomingPeopleDate
    let labels: PeopleLabels

    private static let month: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("MMM")
        return f
    }()

    var body: some View {
        let soon = item.daysUntil <= 7
        Link(destination: personURL(item.date.personSyncId)) {
            HStack(spacing: 10) {
                VStack(spacing: 0) {
                    Text(verbatim: "\(Calendar.current.component(.day, from: item.on))")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(soon ? soonPink : .primary)
                    Text(Self.month.string(from: item.on).uppercased())
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                }
                .frame(width: 34)
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.date.name)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(verbatim: "\(item.date.label) · \(labels.daysUntil(item.daysUntil))")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
        }
    }
}

struct ComingUpWidgetView: View {
    var entry: SnapshotEntry

    private var people: PeopleSnapshot { entry.snapshot.people }

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
        .widgetURL(peopleURL)
    }

    private var content: some View {
        let items = UpcomingPeopleDate.list(people, now: entry.date)
        return Group {
            if items.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    Spacer(minLength: 0)
                    Text(people.labels.comingUpEmpty)
                        .font(.system(size: 13))
                        .foregroundStyle(.primary)
                    Spacer(minLength: 0)
                }
            } else {
                ViewThatFits(in: .vertical) {
                    candidate(items, 3)
                    candidate(items, 2)
                    candidate(items, 1)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var header: some View {
        Text(people.labels.comingUp.uppercased())
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(.secondary)
            .padding(.bottom, 4)
    }

    private func candidate(_ items: [UpcomingPeopleDate], _ count: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ForEach(Array(items.prefix(count).enumerated()), id: \.offset) { _, item in
                ComingUpRowView(item: item, labels: people.labels)
                    .padding(.vertical, 3)
            }
        }
    }
}

struct ComingUpWidget: Widget {
    let kind = "ComingUpWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            ComingUpWidgetView(entry: entry)
        }
        .configurationDisplayName("Coming up")
        .description("The next birthdays and dates.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Lock Screen: next date

// The next birthday or date on the Lock Screen. Accessory families render in
// the system's tint, so hierarchy comes from weight alone, as in
// AccessoryStatusView.
struct NextDateAccessoryView: View {
    var entry: SnapshotEntry

    @Environment(\.widgetFamily) private var family

    var body: some View {
        let people = entry.snapshot.people
        let next = UpcomingPeopleDate.list(people, now: entry.date).first
        Group {
            if family == .accessoryInline {
                if let next {
                    Text(verbatim: "\(next.date.name) · \(next.date.label) · \(people.labels.daysUntil(next.daysUntil))")
                } else {
                    Text(people.labels.comingUp)
                }
            } else {
                VStack(alignment: .leading, spacing: 1) {
                    Text(people.labels.comingUp)
                        .font(.system(size: 12, weight: .bold))
                    if let next {
                        Text(next.date.name)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                        Text(verbatim: "\(next.date.label) · \(people.labels.daysUntil(next.daysUntil))")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    } else {
                        Text(people.labels.comingUpEmpty)
                            .font(.system(size: 12))
                            .lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(next.map { personURL($0.date.personSyncId) } ?? peopleURL)
    }
}

struct NextDateAccessoryWidget: Widget {
    let kind = "NextDateAccessoryWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            NextDateAccessoryView(entry: entry)
        }
        .configurationDisplayName("Next birthday")
        .description("The next birthday or date, on your Lock Screen.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline])
    }
}
