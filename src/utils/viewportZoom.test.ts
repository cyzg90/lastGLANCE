import { describe, it, expect, afterEach, vi } from 'vitest'
import { isFocusZoomPlatform, withScaleLock, lockViewportScaleOnIPhone } from './viewportZoom'

const IPHONE_WKWEBVIEW = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IPAD_SAFARI = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP_SITE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'

describe('isFocusZoomPlatform', () => {
  it('matches the iPhone WebView and Safari', () => {
    expect(isFocusZoomPlatform(IPHONE_WKWEBVIEW)).toBe(true)
  })

  it('leaves iPad alone — iPadOS does not zoom on focus', () => {
    expect(isFocusZoomPlatform(IPAD_SAFARI)).toBe(false)
    expect(isFocusZoomPlatform(IPAD_DESKTOP_SITE)).toBe(false)
  })

  it('leaves Android alone so pinch-to-zoom survives', () => {
    expect(isFocusZoomPlatform(ANDROID_CHROME)).toBe(false)
  })
})

describe('withScaleLock', () => {
  it('caps the scale while keeping the shipped viewport directives', () => {
    const shipped = 'width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content'
    expect(withScaleLock(shipped)).toBe(`${shipped}, maximum-scale=1`)
  })

  it('leaves an explicit maximum-scale from the markup untouched', () => {
    const content = 'width=device-width, maximum-scale=2'
    expect(withScaleLock(content)).toBe(content)
  })

  it('does not mistake another directive for maximum-scale', () => {
    expect(withScaleLock('width=device-width, initial-scale=1')).toBe('width=device-width, initial-scale=1, maximum-scale=1')
  })

  it('handles an empty or trailing-comma content attribute', () => {
    expect(withScaleLock('')).toBe('maximum-scale=1')
    expect(withScaleLock('width=device-width,')).toBe('width=device-width, maximum-scale=1')
  })
})

// Minimal stand-in for the viewport meta element (the suite runs in the node
// environment, so there is no DOM to query).
function stubDocument(content: string | null) {
  const meta = content === null ? null : {
    attrs: { content } as Record<string, string>,
    getAttribute(name: string) { return this.attrs[name] ?? null },
    setAttribute(name: string, value: string) { this.attrs[name] = value },
  }
  vi.stubGlobal('document', { querySelector: () => meta })
  return meta
}

describe('lockViewportScaleOnIPhone', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('caps the live viewport meta on iPhone', () => {
    vi.stubGlobal('navigator', { userAgent: IPHONE_WKWEBVIEW })
    const meta = stubDocument('width=device-width, initial-scale=1.0')
    lockViewportScaleOnIPhone()
    expect(meta!.getAttribute('content')).toBe('width=device-width, initial-scale=1.0, maximum-scale=1')
  })

  it('leaves the meta untouched elsewhere', () => {
    vi.stubGlobal('navigator', { userAgent: ANDROID_CHROME })
    const meta = stubDocument('width=device-width, initial-scale=1.0')
    lockViewportScaleOnIPhone()
    expect(meta!.getAttribute('content')).toBe('width=device-width, initial-scale=1.0')
  })

  it('does not throw on a page with no viewport meta', () => {
    vi.stubGlobal('navigator', { userAgent: IPHONE_WKWEBVIEW })
    stubDocument(null)
    expect(() => lockViewportScaleOnIPhone()).not.toThrow()
  })
})
