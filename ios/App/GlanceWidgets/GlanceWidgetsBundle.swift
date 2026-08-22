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
        AddChoreWidget()
        AccessoryStatusWidget()
        // Control Center controls are iOS 18+; the builder's
        // limited-availability support keeps the rest of the bundle on the
        // extension's 17.0 floor. If this if-availability form fails to
        // compile on some toolchain, the fallback is bumping the extension
        // target to 18.0 and dropping the check - a deliberate trade recorded
        // in the accessory-widgets PR.
        if #available(iOSApplicationExtension 18.0, *) {
            AddChoreControl()
        }
    }
}
