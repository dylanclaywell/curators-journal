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
 * A scanned code opens in the browser, not the installed app — tested on an
 * iPad with the app installed, and there is no link that opens a home-screen
 * app from Safari. The app keeps its own data, so linking *here* sets the hash
 * where the app never looks. What both do share is the clipboard.
 *
 * So in a browser tab the page leads with Copy, and Link is demoted to "this
 * browser instead": still right for someone with no installed app, but the
 * wrong default for the person this is built for. The page can't tell whether
 * an installed app exists — only whether *it* is one — so this shows for
 * everyone in a tab, and says why rather than assuming.
 *
 * The installed app keeps the plain Cancel / Link pair: there it is already
 * the right place, and there is nowhere else to go.
 */
const canCopy =
  typeof navigator !== 'undefined' &&
  typeof navigator.clipboard?.writeText === 'function'
const inBrowser =
  typeof window !== 'undefined' &&
  !window.matchMedia('(display-mode: standalone)').matches
/** Copy leads only where it can work; a tab that can't copy keeps Link. */
const leadWithCopy = inBrowser && canCopy
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

      <div
        class="bevel-in bg-parchment-2 px-2 py-2 font-mono text-[16px] break-all"
      >
        {{ candidate }}
      </div>

      <!-- Oak on a parchment page: the chrome material, so it reads as a
           plaque set into the page rather than another line of body text.
           Deliberately not red, amber or green — those mean quest state here,
           and a notice is not a quest. -->
      <aside
        v-if="inBrowser"
        class="bevel-oak flex flex-col gap-1.5 bg-brown p-3 text-parchment-2"
      >
        <h3
          class="m-0 font-display text-[17px] leading-tight text-gold engraved"
        >
          Best used as an installed app
        </h3>
        <p class="m-0 text-[15px]">
          Curator's Journal is meant to run from your home screen. In a browser
          tab, some browsers — Safari included — clear a site's saved data after
          about a week without a visit, and your quest and diary progress lives
          in that data. You can use it here if you'd rather, but it may be
          wiped.
        </p>
        <p class="m-0 text-[15px]">
          To link the installed app instead, copy the hash, open the app, and
          paste it into Settings. To install it, use Share, then Add to Home
          Screen.
        </p>
      </aside>

      <p v-if="replacing" class="m-0 max-w-[52ch] text-[15px] text-doing">
        This replaces the hash currently set,
        <span class="font-mono break-all">{{ sync.accountHash }}</span
        >.
      </p>

      <p class="m-0 max-w-[52ch] text-[15px] text-ink-soft">
        Your own progress isn't touched, and your merge setting stays as it is.
      </p>

      <!-- Copy leads in a tab; Link steps back to a secondary "this browser
           instead". Two layouts rather than one with reordered classes, so the
           installed app's pair stays exactly as it was. -->
      <template v-if="leadWithCopy">
        <button
          type="button"
          class="tap pressable bevel-oak flex items-center justify-center bg-brown px-3 font-bold text-gold engraved"
          @click="copy"
        >
          {{
            copyState === 'copied'
              ? 'Copied'
              : copyState === 'failed'
                ? "Couldn't copy"
                : 'Copy hash'
          }}
        </button>
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
            class="tap pressable bevel-oak flex flex-[2] items-center justify-center bg-brown-lt px-3 font-bold text-parchment-3"
            @click="link"
          >
            Link this browser instead
          </button>
        </div>
      </template>
      <div v-else class="flex gap-2">
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
