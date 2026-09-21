<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isAccountHash } from '@/lib/sync'
import { useSyncStore } from '@/stores/sync'

/*
 * Where the plugin's QR code lands: `/sync?hash=<account hash>`.
 *
 * A client route, not an API one. `run_worker_first` covers only `/api/*`, so
 * a request here is served from static assets and never wakes the Worker —
 * there is nothing server-side to spam, and `/api/sync` is a different path.
 * The one thing this can change is the account hash stored on this device.
 *
 * **Nothing is applied on load.** A crafted link could otherwise swap the
 * stored hash silently, and the next Refresh would put someone else's synced
 * quests in front of the player. So it always asks first, showing the full hash
 * — except when it matches the one already stored, where asking would be noise.
 *
 * However it ends, it leaves with `router.replace`, so `?hash=` is not left in
 * history. An installed PWA relaunches on the URL it was killed holding, and a
 * link that stayed put would re-prompt on every launch.
 */
const route = useRoute()
const router = useRouter()
const sync = useSyncStore()

/**
 * The hash the link carries, or null if it carries no usable one. A repeated
 * parameter (`?hash=1&hash=2`) is malformed rather than "take the first": the
 * link is ambiguous, and guessing which one was meant is how the wrong account
 * gets linked.
 */
const candidate = computed<string | null>(() => {
  const raw = route.query.hash
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return isAccountHash(trimmed) ? trimmed : null
})

/** The same hash is already stored: nothing to confirm, nothing to change. */
const alreadyLinked = computed(
  () => candidate.value !== null && candidate.value === sync.accountHash,
)

/** Replacing a different hash is worth saying out loud; a first link is not. */
const replacing = computed(
  () => Boolean(sync.accountHash) && !alreadyLinked.value,
)

// The store hydrates from IndexedDB asynchronously. Comparing against its empty
// defaults would treat every link as a new one and could prompt to "replace"
// nothing, so nothing is decided until it has loaded.
watch(
  () => [sync.hydrated, alreadyLinked.value] as const,
  ([hydrated, same]) => {
    if (hydrated && same) void router.replace('/settings')
  },
  { immediate: true },
)

/*
 * Copy, for when this page opened in the browser rather than the installed app.
 *
 * A scanned code opens in the browser, and the installed app may keep its own
 * data, so linking here would set the hash in the wrong place. Copying it lets
 * the player paste into the app's Settings instead — a clipboard is shared
 * between the two even where storage is not.
 *
 * Hidden where the browser can't write to it, and the hint is hidden inside
 * the installed app, where there is nowhere else to go.
 */
const canCopy =
  typeof navigator !== 'undefined' &&
  typeof navigator.clipboard?.writeText === 'function'
const inBrowser =
  typeof window !== 'undefined' &&
  !window.matchMedia('(display-mode: standalone)').matches
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
let copyTimer: ReturnType<typeof setTimeout> | undefined

async function copy(): Promise<void> {
  if (!candidate.value) return
  clearTimeout(copyTimer)
  try {
    await navigator.clipboard.writeText(candidate.value)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
  copyTimer = setTimeout(() => (copyState.value = 'idle'), 2500)
}

onUnmounted(() => clearTimeout(copyTimer))

function link(): void {
  if (!candidate.value) return
  sync.accountHash = candidate.value
  // The cached snapshot belongs to whoever the old hash was. Settings fetches
  // the new one when it opens, since it finds a hash and no snapshot.
  sync.clearSnapshot()
  void router.replace('/settings')
}

function cancel(): void {
  void router.replace('/settings')
}
</script>

<template>
  <div class="flex flex-col gap-3 p-3">
    <p v-if="!sync.hydrated" class="m-0 text-[15px] text-ink-soft">Loading…</p>

    <template v-else-if="candidate === null">
      <h2 class="m-0 font-display text-[19px] leading-tight">
        That link doesn't work
      </h2>
      <p class="m-0 max-w-[52ch] text-[15px] text-ink-soft">
        It doesn't carry a valid account hash. Open the plugin's panel and scan
        the code again, or paste the hash into Settings by hand.
      </p>
      <button
        type="button"
        class="tap pressable bevel-oak flex items-center justify-center bg-brown px-3 font-bold text-gold engraved"
        @click="cancel"
      >
        Go to Settings
      </button>
    </template>

    <!-- While `alreadyLinked` the watcher above is already redirecting, so this
         renders for at most a frame rather than flashing a prompt. -->
    <template v-else-if="!alreadyLinked">
      <h2 class="m-0 font-display text-[19px] leading-tight">
        Link this device to RuneLite?
      </h2>

      <p class="m-0 max-w-[52ch] text-[15px] text-ink-soft">
        This link wants to set the account hash used to load your synced quests
        and diaries. Double-check that it matches the one in the RuneLite
        plugin's panel.
      </p>

      <div class="flex gap-2">
        <div
          class="bevel-in min-w-0 flex-1 bg-parchment-2 px-2 py-2 font-mono text-[16px] break-all"
        >
          {{ candidate }}
        </div>
        <button
          v-if="canCopy"
          type="button"
          class="tap pressable bevel-oak flex w-20 shrink-0 items-center justify-center bg-brown-lt px-2 font-bold text-parchment-3"
          @click="copy"
        >
          {{
            copyState === 'copied'
              ? 'Copied'
              : copyState === 'failed'
                ? 'Failed'
                : 'Copy'
          }}
        </button>
      </div>

      <p v-if="inBrowser" class="m-0 max-w-[52ch] text-[15px] text-ink-soft">
        Using the installed app? It keeps its own data, separate from this
        browser, so linking here won't link it. Copy the hash, open the app, and
        paste it into Settings there.
      </p>

      <p v-if="replacing" class="m-0 max-w-[52ch] text-[15px] text-doing">
        This replaces the hash currently set,
        <span class="font-mono break-all">{{ sync.accountHash }}</span
        >.
      </p>

      <p class="m-0 max-w-[52ch] text-[15px] text-ink-soft">
        Your own progress isn't touched, and your merge setting stays as it is.
      </p>

      <div class="flex gap-2">
        <button
          type="button"
          class="tap pressable bevel-oak flex flex-1 items-center justify-center bg-brown-lt px-3 font-bold text-parchment-3"
          @click="cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          class="tap pressable bevel-oak flex flex-1 items-center justify-center bg-brown px-3 font-bold text-gold engraved"
          @click="link"
        >
          Link
        </button>
      </div>
    </template>
  </div>
</template>
