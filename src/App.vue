<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import TabBar from '@/components/TabBar.vue'
import { usePullToRefresh } from '@/composables/usePullToRefresh'
import { pageHeader } from '@/composables/usePageHeader'
import { panelById } from '@/panels/registry'

const route = useRoute()
const activePanel = computed(() => panelById(String(route.meta.panelId ?? '')))
const headerTitle = computed(
  () =>
    pageHeader.value?.title ?? activePanel.value?.title ?? "Curator's Journal",
)

const scroller = ref<HTMLElement | null>(null)

/**
 * Refetch the data, and ask the service worker whether there's a new version.
 *
 * Deliberately not `location.reload()`. Under `registerType: 'autoUpdate'` a
 * reload usually serves the same cached build anyway, and it would throw away
 * the UI state this app depends on keeping — active panel, scroll position,
 * and later the current quest and step.
 *
 * The stores are imported dynamically to keep localForage out of the initial
 * bundle; that was measured at ~11 KB gzipped and is why this handler used to
 * live in StatsView instead.
 *
 * It works from any panel because the *settings* store hydrates itself, and
 * `load()` needs nothing but a username. The "it will be inert" warning below
 * applies to `refreshIfStale`, which needs an existing snapshot — not to this.
 */
async function refresh(): Promise<void> {
  const [{ useSettingsStore }, { useHiscoresStore }] = await Promise.all([
    import('@/stores/settings'),
    import('@/stores/hiscores'),
  ])

  const settings = useSettingsStore()
  const hiscores = useHiscoresStore()

  // A quiet check: with autoUpdate the worker installs a newer build itself,
  // so this only needs to prompt the lookup. Never throws the session away.
  void navigator.serviceWorker
    ?.getRegistration()
    .then((registration) => registration?.update())
    .catch(() => {})

  if (!settings.hydrated || !settings.username) return
  await hiscores.load(settings.username, settings.accountType)
}

const { distance, phase } = usePullToRefresh(scroller, refresh)

const pullLabel = computed(() => {
  if (phase.value === 'refreshing') return 'Refreshing'
  return phase.value === 'armed' ? 'Release to refresh' : 'Pull to refresh'
})

/*
 * Refresh-on-resume (4f), moved up from StatsView.
 *
 * It used to be scoped to that view because `refreshIfStale` needs an
 * existing snapshot and StatsView was the only thing that seeded one — an
 * app-level listener would have done nothing on every other panel. That
 * stopped being true once `hiscores.ensureLoaded()` let any panel hydrate a
 * snapshot from settings and cache (built for the quest panel, which hit the
 * same "no username" bug this file's `refresh()` comment describes).
 *
 * `refreshIfStale` is still a quiet no-op with nothing to refresh, so this is
 * safe to run from every panel rather than just the one that happens to have
 * loaded something. The dynamic import matches `refresh()` above — keeps
 * localForage out of the initial bundle.
 */
async function onVisibilityChange(): Promise<void> {
  if (document.visibilityState !== 'visible') return
  const { useHiscoresStore } = await import('@/stores/hiscores')
  void useHiscoresStore().refreshIfStale()
}

onMounted(() =>
  document.addEventListener('visibilitychange', onVisibilityChange),
)
onUnmounted(() =>
  document.removeEventListener('visibilitychange', onVisibilityChange),
)
</script>

<template>
  <!-- The shell: a full-height column that never scrolls as a whole. Only the
       panel body scrolls, so the header and tab bar stay put however the window
       is sized. The beveled frame is the direction's signature — light on the
       top/left, dark on the bottom/right.

       This is still the tall-and-narrow arrangement. The wide-and-shallow
       docked case wants the tabs in a left strip instead; see CLAUDE.md. -->
  <div
    class="rail-shell bevel flex h-full flex-col overflow-hidden bg-parchment"
  >
    <header
      class="shrink-0 border-b-2 border-bevel-dk bg-brown px-3 pb-2.5 pt-[max(0.5rem,env(safe-area-inset-top))]"
    >
      <!-- Centred, because iPadOS puts its own window menu (the three dots)
           over the top-left corner in windowed mode, where it covered the
           title. Centre is also where a quest journal puts its heading, so
           this costs nothing diegetically.

           A back button (quest detail, and whatever full-panel views follow
           it) goes on the right for the same reason — the left is where that
           menu sits. A same-width spacer on the left keeps the title
           genuinely centred whether or not a back button is present, rather
           than the title drifting right when it's there. -->
      <div class="flex items-center gap-2">
        <div class="w-11 shrink-0" aria-hidden="true" />
        <h1
          class="m-0 min-w-0 flex-1 truncate text-center font-display text-[22px] font-normal text-gold engraved"
        >
          {{ headerTitle }}
        </h1>
        <RouterLink
          v-if="pageHeader?.backTo"
          :to="pageHeader.backTo"
          aria-label="Back"
          class="tap pressable bevel-oak flex w-11 shrink-0 items-center justify-center bg-brown-lt text-gold"
        >
          <AppIcon name="back" :size="18" />
        </RouterLink>
        <div v-else class="w-11 shrink-0" aria-hidden="true" />
      </div>
    </header>

    <!-- Pull-to-refresh indicator. An oak band revealed above the panel, so it
         reads as the header stretching rather than as a floating widget — and
         so the engraved label stays on oak, where it belongs. Height follows
         the finger; the transition only applies once the gesture lets go, or
         it would lag behind the drag. -->
    <div
      class="flex shrink-0 items-end justify-center overflow-hidden bg-brown"
      :class="
        phase === 'idle' || phase === 'refreshing'
          ? 'transition-[height] duration-200'
          : ''
      "
      :style="{ height: `${distance}px` }"
      aria-hidden="true"
    >
      <div
        class="flex items-center gap-2 pb-1.5 text-[13px] font-bold text-gold engraved"
      >
        <AppIcon
          name="refresh"
          :size="14"
          :class="phase === 'refreshing' ? 'animate-spin' : ''"
        />
        {{ pullLabel }}
      </div>
    </div>

    <!-- The one scrolling region, and what the pull gesture is measured
         against: it arms only when this is at scrollTop 0. -->
    <main
      ref="scroller"
      class="@container min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
    >
      <RouterView />
    </main>

    <!-- Screen readers get the state as text; the gesture itself is
         touch-only, and the Stats panel keeps its own refresh button. -->
    <p role="status" aria-live="polite" class="sr-only">
      {{ phase === 'refreshing' ? 'Refreshing' : '' }}
    </p>

    <TabBar />
  </div>
</template>
