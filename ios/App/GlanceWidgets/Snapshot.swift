import Foundation

// Swift view of the snapshot contract defined in src/native/snapshot.ts. The web
// app is the only writer; this side is read-only and must never assume more than
// the contract guarantees.
//
// Decoding is deliberately lenient: every field falls back to a default rather
// than throwing. A widget that renders an empty heatmap because one chore had an
// unexpected field is a bad trade against a widget that renders nothing at all,
// and the two processes are versioned independently (the WebView updates with the
// app bundle, but a placed widget can be asked to render at any moment).

enum ChoreState: String, Decodable {
    case fresh, soon, overdue, none
}

struct SnapshotChore: Decodable {
    let syncId: String
    let name: String
    let icon: String?
    let categoryName: String?
    let lastCompletedAt: String?
    let elapsedDays: Double?
    let targetCadenceDays: Double?
    let ratio: Double?
    let color: String?
    let state: ChoreState

    private enum CodingKeys: String, CodingKey {
        case syncId, name, icon, categoryName, lastCompletedAt
        case elapsedDays, targetCadenceDays, ratio, color, state
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        syncId = (try? c.decode(String.self, forKey: .syncId)) ?? ""
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        icon = try? c.decode(String.self, forKey: .icon)
        categoryName = try? c.decode(String.self, forKey: .categoryName)
        lastCompletedAt = try? c.decode(String.self, forKey: .lastCompletedAt)
        // Numbers are decoded as Double even where the TS side only ever emits
        // integers: elapsed_days can be fractional, and an Int decode would throw
        // on the first half-day rather than degrade.
        elapsedDays = try? c.decode(Double.self, forKey: .elapsedDays)
        targetCadenceDays = try? c.decode(Double.self, forKey: .targetCadenceDays)
        ratio = try? c.decode(Double.self, forKey: .ratio)
        color = try? c.decode(String.self, forKey: .color)
        state = (try? c.decode(ChoreState.self, forKey: .state)) ?? .none
    }
}

struct WidgetSnapshot: Decodable {
    struct Counts: Decodable {
        let overdue: Int
        let soon: Int

        init(overdue: Int = 0, soon: Int = 0) {
            self.overdue = overdue
            self.soon = soon
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            overdue = (try? c.decode(Int.self, forKey: .overdue)) ?? 0
            soon = (try? c.decode(Int.self, forKey: .soon)) ?? 0
        }

        private enum CodingKeys: String, CodingKey { case overdue, soon }
    }

    let version: Int
    let generatedAt: String?
    let counts: Counts
    // Keyed "yyyy-MM-dd" (local dates, as produced by dayjs in the WebView) to a
    // completion count for that day.
    let heatmap: [String: Int]
    let chores: [SnapshotChore]

    init(version: Int = 1,
         generatedAt: String? = nil,
         counts: Counts = Counts(),
         heatmap: [String: Int] = [:],
         chores: [SnapshotChore] = []) {
        self.version = version
        self.generatedAt = generatedAt
        self.counts = counts
        self.heatmap = heatmap
        self.chores = chores
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = (try? c.decode(Int.self, forKey: .version)) ?? 1
        generatedAt = try? c.decode(String.self, forKey: .generatedAt)
        counts = (try? c.decode(Counts.self, forKey: .counts)) ?? Counts()
        heatmap = (try? c.decode([String: Int].self, forKey: .heatmap)) ?? [:]
        chores = (try? c.decode([SnapshotChore].self, forKey: .chores)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case version, generatedAt, counts, heatmap, chores
    }

    // The snapshot currently in the App Group, or an empty one. Returns empty
    // rather than nil so callers have a single render path: before the first
    // foreground of an updated app there is genuinely no snapshot yet, and that
    // should look like "no activity", not like an error.
    static func load() -> WidgetSnapshot {
        guard let raw = SharedDataStore.readSnapshot(),
              let decoded = try? JSONDecoder().decode(WidgetSnapshot.self, from: Data(raw.utf8))
        else { return WidgetSnapshot() }
        return decoded
    }
}
