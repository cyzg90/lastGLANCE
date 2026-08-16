import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

/**
 * App-styled tooltips, replacing the native `title` attribute.
 *
 * The browser's own tooltip cannot be sped up — its delay belongs to the OS, not
 * the page — and it ignores the app's theme, never appears on keyboard focus,
 * and renders as unstyled system chrome. This replaces it: ~120ms on hover,
 * immediately on keyboard focus, and never on touch (a coarse pointer has no
 * hover state, so there is nothing to reveal; the element's aria-label still
 * carries the meaning for assistive tech).
 *
 * Usage is an attribute — `data-tooltip="…"` on any element, anywhere, with an
 * optional `data-tooltip-detail="…"` for a quieter second line beneath it.
 * <TooltipHost/> is mounted once at the app root and delegates from `document`,
 * so one set of listeners serves every surface, including modals that portal
 * out of the React tree and grids of hundreds of cells (the heatmaps, the icon
 * picker) that could never afford a component instance each.
 *
 * Placement is automatic: above the anchor, flipping below when it would clip
 * the top of the viewport, and clamped horizontally to stay on screen.
 *
 * Line breaks in the label survive (`whitespace-pre-line`), so a multi-line
 * value such as a chore's details keeps its own bullet lines instead of
 * collapsing into one run-on sentence. Single-line labels are unaffected.
 */

const SHOW_DELAY = 120
const GAP = 8
const MARGIN = 6

interface Anchor { rect: DOMRect; label: string; detail?: string }

function TooltipBubble({ anchor }: { anchor: Anchor }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Measure first, then place: the bubble is sized by its own text, so its box
  // is what decides whether it fits above the anchor and how far it has to be
  // clamped off the viewport edge. It stays transparent until placed, which
  // doubles as the fade-in.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const r = anchor.rect

    const fitsAbove = r.top - height - GAP >= MARGIN
    const top = fitsAbove ? r.top - height - GAP : r.bottom + GAP
    const left = Math.min(
      Math.max(MARGIN, r.left + r.width / 2 - width / 2),
      Math.max(MARGIN, window.innerWidth - width - MARGIN),
    )
    setPos({ left, top })
  }, [anchor])

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      // The anchor already carries this text as its accessible name, so
      // announcing the bubble as well would just say everything twice.
      aria-hidden="true"
      className={`
        fixed z-[70] pointer-events-none max-w-[16rem] px-2 py-1 rounded-md
        text-xs font-medium leading-snug text-center whitespace-pre-line
        bg-slate-800 text-slate-100 dark:bg-slate-700 dark:text-slate-100
        border border-slate-700 dark:border-slate-600 shadow-lg
        transition-opacity duration-100 ${pos ? 'opacity-100' : 'opacity-0'}
      `}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0 }}
    >
      {anchor.label}
      {anchor.detail && (
        <span className="block font-normal text-slate-400 dark:text-slate-400">
          {anchor.detail}
        </span>
      )}
    </div>,
    document.body,
  )
}

function resolve(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null
}

export function TooltipHost() {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const timer = useRef<number | null>(null)
  // Read inside the document listeners, which are registered once.
  const anchorRef = useRef<Anchor | null>(null)
  anchorRef.current = anchor

  const clear = useCallback(() => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null }
  }, [])

  const hide = useCallback(() => { clear(); setAnchor(null) }, [clear])

  const show = useCallback((el: HTMLElement, label: string, delay: number) => {
    if (!label) { hide(); return }
    clear()
    const detail = el.dataset.tooltipDetail || undefined
    timer.current = window.setTimeout(
      () => setAnchor({ rect: el.getBoundingClientRect(), label, detail }),
      delay,
    )
  }, [clear, hide])

  useEffect(() => {
    function onOver(e: PointerEvent) {
      if (e.pointerType !== 'mouse') return
      const el = resolve(e.target)
      if (!el) { hide(); return }
      // Once one tooltip is open, moving to a neighbour swaps it instantly. The
      // delay exists to stop a pointer merely passing through from flickering
      // tooltips, which no longer applies once the user is clearly reading them.
      show(el, el.dataset.tooltip ?? '', anchorRef.current ? 0 : SHOW_DELAY)
    }
    function onFocusIn(e: FocusEvent) {
      const el = resolve(e.target)
      // Keyboard focus reveals it at once; a mouse click focuses too, and
      // popping a tooltip over whatever the click just opened is noise.
      if (el?.matches(':focus-visible')) show(el, el.dataset.tooltip ?? '', 0)
    }
    // The bubble is placed from a rect captured at show time, so anything that
    // moves or obscures the anchor invalidates it.
    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', hide)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', hide)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
      clear()
    }
  }, [show, hide, clear])

  // Escape dismisses it like any other layer. Bound only while one is open so
  // the app's other Escape handlers are untouched the rest of the time.
  useEffect(() => {
    if (!anchor) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') hide() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anchor, hide])

  return anchor ? <TooltipBubble anchor={anchor} /> : null
}
