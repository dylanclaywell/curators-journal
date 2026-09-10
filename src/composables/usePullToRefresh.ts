import { onUnmounted, readonly, ref, watch, type Ref } from 'vue'

/**
 * Pull-to-refresh for a scrolling element.
 *
 * Why a custom gesture rather than the platform's: iOS rubber-bands the
 * *document* whatever `overscroll-behavior` says, and that bounce is not a
 * hookable event. Tracking touches on the scroller ourselves also means the
 * pull only arms at the very top, so it can't fire mid-scroll.
 *
 * Installed in an app that gets swapped away from constantly, where the usual
 * way to refresh a web page — pull down on the address bar — doesn't exist.
 */

/** Pixels of travel before the gesture will fire on release. */
const THRESHOLD = 64

/** Cap, so a long drag doesn't shove the panel off screen. */
const MAX_PULL = 96

/**
 * Finger travel is halved. A 1:1 pull feels loose, and the resistance is what
 * makes a deliberate gesture distinguishable from a scroll that overshot.
 */
const RESISTANCE = 0.5

/**
 * Refreshing is usually faster than the eye can follow, and a spinner that
 * appears for 80ms reads as a glitch rather than as confirmation.
 */
const MIN_VISIBLE_MS = 450

export type PullPhase = 'idle' | 'pulling' | 'armed' | 'refreshing'

export function usePullToRefresh(
  target: Ref<HTMLElement | null>,
  onRefresh: () => Promise<void>,
) {
  const distance = ref(0)
  const phase = ref<PullPhase>('idle')

  let startY = 0
  let tracking = false

  const reset = () => {
    tracking = false
    distance.value = 0
    phase.value = 'idle'
  }

  const onTouchStart = (event: TouchEvent) => {
    const el = target.value
    // Multi-touch is a pinch or a two-finger scroll, never this gesture.
    if (!el || phase.value === 'refreshing' || event.touches.length !== 1)
      return
    // Arm only at the very top, or a fast scroll back up would trigger it.
    if (el.scrollTop > 0) return

    startY = event.touches[0].clientY
    tracking = true
  }

  const onTouchMove = (event: TouchEvent) => {
    const el = target.value
    if (!tracking || !el || phase.value === 'refreshing') return

    const delta = event.touches[0].clientY - startY

    // Scrolling up, or the content moved under us: hand the gesture back.
    if (delta <= 0 || el.scrollTop > 0) {
      if (distance.value > 0) reset()
      else tracking = false
      return
    }

    // Claim the gesture, which also suppresses the document bounce competing
    // with it. Requires a non-passive listener — see the registration below.
    event.preventDefault()

    distance.value = Math.min(delta * RESISTANCE, MAX_PULL)
    phase.value = distance.value >= THRESHOLD ? 'armed' : 'pulling'
  }

  const onTouchEnd = async () => {
    if (!tracking) return
    tracking = false

    if (phase.value !== 'armed') {
      reset()
      return
    }

    phase.value = 'refreshing'
    // Hold the indicator at the threshold while it works, so the spinner has
    // somewhere to sit after the finger lifts.
    distance.value = THRESHOLD

    const started = Date.now()
    try {
      await onRefresh()
    } finally {
      const elapsed = Date.now() - started
      if (elapsed < MIN_VISIBLE_MS) {
        await new Promise((resolve) =>
          setTimeout(resolve, MIN_VISIBLE_MS - elapsed),
        )
      }
      reset()
    }
  }

  /**
   * `touchmove` is registered non-passive because the handler calls
   * `preventDefault()`. Browsers default document-level touch listeners to
   * passive, where that call is ignored with a console warning.
   */
  const attach = (el: HTMLElement) => {
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', reset, { passive: true })
  }

  const detach = (el: HTMLElement) => {
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
    el.removeEventListener('touchcancel', reset)
  }

  // The element arrives after mount, and swaps if the shell ever re-renders.
  watch(
    target,
    (el, previous) => {
      if (previous) detach(previous)
      if (el) attach(el)
    },
    { immediate: true },
  )

  onUnmounted(() => {
    if (target.value) detach(target.value)
  })

  return {
    /** Pixels to offset the panel by, so the indicator follows the finger. */
    distance: readonly(distance),
    phase: readonly(phase),
    threshold: THRESHOLD,
  }
}
