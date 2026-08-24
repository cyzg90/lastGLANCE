// iPhone WebKit zooms the whole page in when a form control whose computed
// font-size is under 16px takes focus. Inside the native shell that zoom is a
// one-way trip: Capacitor's iOS default is `zoomingEnabled = NO`, which hands
// the WebView's scroll view a delegate that disables the pinch recognizer the
// moment zooming begins, so nothing can scale the page back down and the UI
// stays cropped until the app is force-quit and relaunched. A home-screen PWA
// behaves the same way once the viewport is locked; only a Safari tab lets the
// user pinch back out.
//
// Every text field in the app is text-sm (14px) or smaller, but Search and the
// chore form are the two screens that focus an input the instant they open
// (SearchModal's focus effect, ChoreFormModal's autoFocus), so they trip the
// zoom without the user ever tapping into a field — which is why only those two
// appear to be broken.
//
// Capping the viewport at scale 1 leaves WebKit no headroom to zoom on focus.
// WKWebView honors the page's scale limits (`ignoresViewportScaleLimits`
// defaults to false and Capacitor never overrides it), as does a standalone
// PWA. Safari tabs ignore the cap, but the zoom is recoverable by pinch there.
//
// Deliberately iPhone/iPod only: iPadOS does not focus-zoom, and Android and
// the desktop browser must keep pinch-to-zoom, which this would take away.

// Matches the native shell's WKWebView UA and Mobile Safari alike; an iPad
// (including one asking for the desktop site, which reports "Macintosh") does
// not match, and neither does anything non-Apple.
export function isFocusZoomPlatform(userAgent: string): boolean {
  return /iPhone|iPod/.test(userAgent)
}

// Appends the scale cap, preserving whatever else the meta already declares
// (width, viewport-fit, interactive-widget). An explicit maximum-scale in the
// markup wins — this only fills in the one that isn't there.
export function withScaleLock(content: string): string {
  if (/(^|[;,\s])maximum-scale\s*=/.test(content)) return content
  const existing = content.trim().replace(/,$/, '')
  return existing === '' ? 'maximum-scale=1' : `${existing}, maximum-scale=1`
}

// Applies the cap to the live viewport meta. Safe to call anywhere: a no-op off
// iPhone, and off any page that has no viewport meta.
export function lockViewportScaleOnIPhone(): void {
  if (!isFocusZoomPlatform(navigator.userAgent)) return
  const meta = document.querySelector('meta[name="viewport"]')
  if (!meta) return
  meta.setAttribute('content', withScaleLock(meta.getAttribute('content') ?? ''))
}
