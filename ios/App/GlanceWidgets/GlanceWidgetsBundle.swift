import SwiftUI
import WidgetKit

// Entry point for the WidgetKit extension: the same three widget surfaces the
// Android glance/ package ships — heatmap, soon/overdue list, and the
// configurable single-chore tile — all rendering from the one App-Group
// snapshot.
@main
struct GlanceWidgetsBundle: WidgetBundle {
    var body: some Widget {
        HeatmapWidget()
        SoonListWidget()
        SingleChoreWidget()
    }
}
