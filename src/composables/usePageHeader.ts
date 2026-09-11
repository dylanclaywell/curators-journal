import { ref } from 'vue'

/**
 * Overrides the shell's header — title and an optional back link — for a
 * full-panel view drilled into from a tab, such as quest detail.
 *
 * A plain shared ref rather than route `meta`: the title isn't known at route
 * definition time (it depends on data a lazy-loaded view fetches, like a
 * quest's name), and App.vue — the header's owner — is in the initial bundle,
 * so it can't statically import the store that would know it.
 *
 * The view that sets this owns clearing it too (see QuestDetailView's
 * `onUnmounted`), since only it knows when it's actually been navigated away
 * from — Vue Router reuses a route component across param-only changes, so a
 * plain "did this route change" check would miss going from one quest
 * straight to another.
 */
export interface PageHeader {
  title: string
  /** Route to return to. Always present-tense correct: the panel this view
   *  was reached from, not `history.back()`, which can't be trusted after a
   *  cold-launch deep link. */
  backTo: string
}

export const pageHeader = ref<PageHeader | null>(null)
