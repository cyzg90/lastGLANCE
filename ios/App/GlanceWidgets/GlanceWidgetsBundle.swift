import SwiftUI
import WidgetKit

// Entry point for the WidgetKit extension. Phase 0 ships only the heatmap, which
// exists to prove the App-Group read path end to end; the soon/overdue list and
// the configurable single-chore widget join this bundle in Phase 2.
@main
struct GlanceWidgetsBundle: WidgetBundle {
    var body: some Widget {
        HeatmapWidget()
    }
}
