import { useEffect, useState } from 'react'

export interface ViewportRect {
  /** Height of the currently-visible area (shrinks when the keyboard opens). */
  height: number
  /** Distance from the layout-viewport top to the visible area's top. */
  offsetTop: number
}

/**
 * Tracks the visual viewport so overlays can sit above the on-screen keyboard.
 *
 * iOS Safari — and especially standalone (home-screen) PWAs — do NOT resize the
 * layout viewport when the keyboard opens. A `fixed inset-0` bottom sheet is
 * therefore anchored to the full screen and gets hidden behind the keyboard. By
 * mirroring the visible rectangle (height + top offset) and pinning the sheet to
 * it, the editor floats just above the keyboard where it can be seen and typed.
 */
export function useVisualViewport(): ViewportRect {
  const [rect, setRect] = useState<ViewportRect>(() => ({
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
    offsetTop: 0,
  }))

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) {
      // Fallback: track window resize so at least the height stays sane.
      const onResize = () => setRect({ height: window.innerHeight, offsetTop: 0 })
      onResize()
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
    const update = () => setRect({ height: vv.height, offsetTop: vv.offsetTop })
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return rect
}
