<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { createBackup, parseBackup } from '@/lib/backup'
import { isAccountHash } from '@/lib/sync'
import { useQuestsStore } from '@/stores/quests'
import { useDiariesStore } from '@/stores/diaries'
import { useSyncStore } from '@/stores/sync'
import { useSettingsStore } from '@/stores/settings'

/**
 * Doubles as the required Fan Content Policy notice and as a ruler.
 *
 * Stage Manager's minimum window width isn't something we can look up
 * reliably — it varies by iPad model and iPadOS version — so the panel just
 * reports the live width. Dock the app, drag it as narrow as it will go, and
 * read the number.
 */
/* Templates resolve names against the component instance, not globals, so the
   build-time define has to be surfaced as a binding. */
const version = __APP_VERSION__

const width = ref(0)
const height = ref(0)
const dpr = ref(1)
const installed = ref(false)

function measure() {
  width.value = window.innerWidth
  height.value = window.innerHeight
  dpr.value = window.devicePixelRatio
  installed.value = window.matchMedia('(display-mode: standalone)').matches
}

onMounted(() => {
  measure()
  // One fetch per session, from the cache otherwise — the plugin writes when
  // the player syncs, not continuously, so there's no cadence worth guessing.
  void sync.ensureLoaded()
  // This panel reads quest data too: without the dataset the index is empty,
  // every synced id looks unknown, and the drift warning accuses the plugin of
  // sending 19 quests that do not exist. Panels ask a store for what they
  // need rather than relying on another panel having been opened first.
  void quests.ensureReady()
  // The same for diary tiers: with no dataset there is no index to check
  // synced tier ids against, so the count would read zero and drift could
  // never be reported. It is a lazy chunk, and precached, so this costs a
  // cache read rather than a network fetch once the app is installed.
  void diaries.ensureDataset()
  window.addEventListener('resize', measure)
  // iOS reports interface-driven size changes here rather than on `resize`.
  window.visualViewport?.addEventListener('resize', measure)
})

onUnmounted(() => {
  window.removeEventListener('resize', measure)
  window.visualViewport?.removeEventListener('resize', measure)
})

/*
 * Export/import: the safety net `persist.ts` and CLAUDE.md have long
 * described but that never existed until now (ROADMAP slice 4b′). It covers
 * only the hand-entered, unrecoverable half of the state — settings and quest
 * progress/goals — not cached hiscores, which refetch themselves from a
 * username and would just bloat the file.
 */
const settings = useSettingsStore()
const quests = useQuestsStore()
const diaries = useDiariesStore()
const sync = useSyncStore()

const fileInput = ref<HTMLInputElement | null>(null)
const importMessage = ref<{ kind: 'ok' | 'error'; text: string } | null>(null)

// Both stores hydrate asynchronously from IndexedDB on creation. Acting before
// that finishes risks exporting the empty initial state, or an import getting
// silently dropped by a store that isn't yet persisting writes.
const dataReady = computed(
  () =>
    settings.hydrated && quests.hydrated && diaries.hydrated && sync.hydrated,
)

function exportBackup() {
  const backup = createBackup({
    username: settings.username,
    accountType: settings.accountType,
    progress: quests.progress,
    goals: quests.goals,
    // The cached snapshot is deliberately absent — it refetches from the hash.
    // The hash itself is not recoverable without going back to RuneLite.
    accountHash: sync.accountHash,
    mergeEnabled: sync.mergeEnabled,
    // Tier completions are hand-entered and have no other source, so they
    // belong in the backup for exactly the reason quest progress does.
    diaryTasks: diaries.doneTasks,
  })
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `curators-journal-backup-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
  importMessage.value = null
}

/**
 * Synced quests that this build has a quest for. The unknown ones are counted
 * separately — they're drift between the plugin and `build:quests`, and
 * silently dropping them is how that drift stays invisible.
 */
const syncedCount = computed(() => Object.keys(quests.syncedProgress).length)

/*
 * The account hash is edited as a draft and only written on Save.
 *
 * It used to bind straight to the store, so every keystroke overwrote the
 * saved value — a slip while typing lost a nineteen-digit number that can only
 * be got back from RuneLite, and left the previous account's snapshot cached
 * against a half-typed hash. The draft is plain component state on purpose:
 * leaving the panel or reloading discards it, which is the "undo".
 *
 * It re-syncs whenever the saved value changes underneath it — hydration
 * finishing, a backup import, a `/sync` link — so it never shows a stale one.
 */
const hashDraft = ref('')
watch(
  () => sync.accountHash,
  (saved) => {
    hashDraft.value = saved
  },
  { immediate: true },
)

const draftHash = computed(() => hashDraft.value.trim())
const hashChanged = computed(() => draftHash.value !== sync.accountHash)
/** Empty is allowed — it is how a hash is cleared — anything else must be one. */
const hashInvalid = computed(
  () => draftHash.value !== '' && !isAccountHash(draftHash.value),
)
const canSaveHash = computed(
  () => sync.hydrated && hashChanged.value && !hashInvalid.value,
)

/*
 * Paste from the clipboard, for the hash the plugin's QR page copied.
 *
 * It fills the draft and stops there. Saving stays a separate, deliberate tap,
 * so a clipboard that held the wrong thing costs a glance at the field rather
 * than a replaced hash. What came off the clipboard is never echoed in a
 * message: it can be anything the player last copied.
 *
 * Hidden where the browser can't read the clipboard at all, rather than shown
 * and failing. Where it can, iOS asks for permission on each paste, so a denial
 * lands in the catch and is not treated as a bug.
 */
const canPaste =
  typeof navigator !== 'undefined' &&
  typeof navigator.clipboard?.readText === 'function'
const pasteMessage = ref<string | null>(null)

async function pasteHash() {
  pasteMessage.value = null
  try {
    const text = (await navigator.clipboard.readText()).trim()
    if (!isAccountHash(text)) {
      pasteMessage.value = "The clipboard doesn't hold an account hash."
      return
    }
    hashDraft.value = text
  } catch {
    pasteMessage.value =
      "Couldn't read the clipboard. Paste into the field by hand."
  }
}

function saveHash() {
  if (!canSaveHash.value) return
  sync.setAccountHash(draftHash.value)
  // The old snapshot is gone, so fetch the new account's rather than leaving
  // the panel empty until the player thinks to press Refresh.
  void sync.refresh()
}

const lastSynced = computed(() => {
  const at = sync.snapshot?.receivedAt
  return at ? new Date(at).toLocaleString() : null
})

function chooseImportFile() {
  fileInput.value?.click()
}

async function onImportFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Cleared even on success, so choosing the same file twice in a row still
  // fires a change event.
  input.value = ''
  if (!file) return

  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    importMessage.value = {
      kind: 'error',
      text: 'That file is not valid JSON.',
    }
    return
  }

  const result = parseBackup(parsed)
  if (!result.ok) {
    importMessage.value = { kind: 'error', text: result.error }
    return
  }

  // Destructive and hard to reverse — it overwrites whatever progress and
  // goals are currently stored — so confirm before touching anything.
  const confirmed = window.confirm(
    `Replace your current quest progress and settings with this backup from ${new Date(result.backup.exportedAt).toLocaleString()}?`,
  )
  if (!confirmed) return

  settings.username = result.backup.settings.username
  settings.accountType = result.backup.settings.accountType
  quests.progress = result.backup.quests.progress
  quests.goals = result.backup.quests.goals

  // Absent in backups written before Phase 5, and an older file should leave
  // the current sync settings alone rather than blanking them.
  if (result.backup.sync) {
    sync.accountHash = result.backup.sync.accountHash
    sync.mergeEnabled = result.backup.sync.mergeEnabled
    // The cache belongs to whoever the old hash was; refetched on next open.
    sync.clearSnapshot()
  }

  // Absent before Phase 6. Same reasoning as sync: an older backup should
  // leave diary progress alone rather than wiping it.
  if (result.backup.diaries) {
    diaries.doneTasks = result.backup.diaries.tasks
  }

  importMessage.value = { kind: 'ok', text: 'Backup restored.' }
}
</script>

<template>
  <div class="flex flex-col gap-4 p-3">
    <section class="flex flex-col gap-2">
      <h2 class="m-0 font-display text-[19px] leading-tight">This window</h2>

      <!-- The width is the headline figure: it's the number the whole layout
           is designed against, and the reason this readout exists. -->
      <div class="bevel-in flex items-baseline gap-2 bg-parchment-2 px-3 py-2">
        <span class="nums font-display text-[32px] leading-none">{{
          width
        }}</span>
        <span class="text-ink-soft">&times;</span>
        <span class="nums font-display text-[32px] leading-none">{{
          height
        }}</span>
        <span class="text-ink-soft">px</span>
      </div>

      <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[15px]">
        <dt class="text-ink-soft">Pixel ratio</dt>
        <dd class="nums m-0">{{ dpr }}&times;</dd>
        <dt class="text-ink-soft">Installed</dt>
        <dd class="m-0">
          {{ installed ? 'Yes, running standalone' : 'No, running in Safari' }}
        </dd>
        <dt class="text-ink-soft">Version</dt>
        <dd class="nums m-0">{{ version }}</dd>
      </dl>

      <p v-if="!installed" class="m-0 text-[15px] text-ink-soft">
        Add Curator's Journal to your home screen. Safari clears storage for
        uninstalled sites after about a week idle, and your quest completions
        live in it.
      </p>
    </section>

    <hr class="m-0 h-0 border-0 border-t-2 border-t-bevel-dk" />

    <section class="flex flex-col gap-2">
      <h2 class="m-0 font-display text-[19px] leading-tight">RuneLite sync</h2>

      <p class="m-0 max-w-[52ch] text-[15px] text-ink-soft">
        The companion plugin can send your quest and achievement diary state
        here, so you don't have to enter it by hand. Paste the account hash it
        shows you.
      </p>

      <!-- A form so Enter (or the keyboard's Go) saves. Nothing is written
           until it does: the field edits a draft, and Save is enabled only
           once the draft is a valid hash that differs from the saved one. -->
      <form class="flex flex-col gap-1" @submit.prevent="saveHash">
        <label for="account-hash" class="text-[15px] font-bold">
          Account hash
        </label>
        <div class="flex gap-2">
          <!-- Monospace and numeric: it's a nineteen-digit number read off
               another screen, which is exactly when a transposed digit hides. -->
          <input
            id="account-hash"
            v-model="hashDraft"
            :aria-invalid="hashInvalid"
            type="text"
            inputmode="numeric"
            autocapitalize="none"
            autocomplete="off"
            spellcheck="false"
            maxlength="20"
            placeholder="1234567890123456789"
            class="tap bevel-in min-w-0 flex-1 bg-parchment-2 px-2 font-mono text-[16px] text-ink placeholder:text-ink-soft/60"
          />
          <button
            type="submit"
            :disabled="!canSaveHash"
            class="tap pressable bevel-oak flex items-center justify-center bg-brown px-4 font-bold text-gold engraved disabled:opacity-50"
          >
            Save
          </button>
        </div>
        <p v-if="hashInvalid" class="m-0 text-[15px] text-todo">
          An account hash is digits only, up to 20 of them.
        </p>
      </form>

      <!-- Its own row rather than beside Save: at the 375px floor a second
           button would squeeze the field below a full nineteen digits. Outside
           the form so it can never be what Enter submits. -->
      <template v-if="canPaste">
        <button
          type="button"
          class="tap pressable bevel-oak flex items-center justify-center bg-brown-lt px-3 font-bold text-parchment-3"
          @click="pasteHash"
        >
          Paste from clipboard
        </button>
        <p v-if="pasteMessage" class="m-0 text-[15px] text-todo">
          {{ pasteMessage }}
        </p>
      </template>

      <label
        class="tap pressable-parchment bevel-in flex items-center gap-2 bg-parchment-2 px-2"
      >
        <input v-model="sync.mergeEnabled" type="checkbox" class="size-4" />
        <span class="text-[15px] font-bold">
          Merge synced quests and diaries
        </span>
      </label>

      <p class="m-0 max-w-[52ch] text-[15px] text-ink-soft">
        Merging only ever marks a quest or diary tier further along, never back,
        and nothing synced is written to your own record — so turning this off
        restores exactly what you entered. Diaries sync a whole tier at a time;
        the game doesn't expose individual tasks.
      </p>

      <div class="flex gap-2">
        <button
          type="button"
          :disabled="!sync.accountHash || sync.loading"
          class="tap pressable bevel-oak flex flex-1 items-center justify-center gap-2 bg-brown font-bold text-gold engraved disabled:opacity-50"
          @click="sync.refresh()"
        >
          <AppIcon name="refresh" :size="15" />
          {{ sync.loading ? 'Refreshing…' : 'Refresh' }}
        </button>
      </div>

      <p v-if="sync.error" class="m-0 text-[15px] text-todo">
        {{ sync.error }}
      </p>

      <p v-else-if="lastSynced" class="m-0 text-[15px] text-ink-soft">
        <span class="nums">{{ syncedCount }}</span>
        quest<span v-if="syncedCount !== 1">s</span> and
        <span class="nums">{{ diaries.syncedTiers.length }}</span>
        diary tier<span v-if="diaries.syncedTiers.length !== 1">s</span> synced,
        last updated {{ lastSynced }}.
      </p>

      <!-- Drift, not an error: the plugin named a quest this dataset has no
           entry for, which means build:quests should be re-run. -->
      <p
        v-if="quests.syncUnknownIds.length"
        class="m-0 max-w-[52ch] text-[15px] text-doing"
      >
        <span class="nums">{{ quests.syncUnknownIds.length }}</span>
        synced quest<span v-if="quests.syncUnknownIds.length !== 1">s</span>
        aren't in this app's quest list and were ignored.
      </p>

      <!-- The same drift report for diary tiers: the plugin sent a tier id
           this dataset has no entry for, so build:diaries is out of step. -->
      <p
        v-if="diaries.syncUnknownTierIds.length"
        class="m-0 max-w-[52ch] text-[15px] text-doing"
      >
        <span class="nums">{{ diaries.syncUnknownTierIds.length }}</span>
        <template v-if="diaries.syncUnknownTierIds.length === 1">
          synced diary tier isn't in this app's diary list and was ignored.
        </template>
        <template v-else>
          synced diary tiers aren't in this app's diary list and were ignored.
        </template>
      </p>
    </section>

    <hr class="m-0 h-0 border-0 border-t-2 border-t-bevel-dk" />

    <section class="flex flex-col gap-2">
      <h2 class="m-0 font-display text-[19px] leading-tight">Your data</h2>

      <p class="m-0 max-w-[52ch] text-[15px] text-ink-soft">
        Quest progress and goals live only on this device. Export a backup
        before switching phones, reinstalling, or leaving the app uninstalled
        and idle — Safari clears storage after about a week.
      </p>

      <div class="flex gap-2">
        <button
          type="button"
          :disabled="!dataReady"
          class="tap pressable bevel-oak flex flex-1 items-center justify-center gap-2 bg-brown font-bold text-gold engraved disabled:opacity-50"
          @click="exportBackup"
        >
          <AppIcon name="download" :size="15" />
          Export
        </button>
        <button
          type="button"
          :disabled="!dataReady"
          class="tap pressable bevel-oak flex flex-1 items-center justify-center gap-2 bg-brown font-bold text-gold engraved disabled:opacity-50"
          @click="chooseImportFile"
        >
          <AppIcon name="upload" :size="15" />
          Import
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="application/json"
          class="hidden"
          @change="onImportFileChosen"
        />
      </div>

      <p
        v-if="importMessage"
        class="m-0 text-[15px]"
        :class="importMessage.kind === 'error' ? 'text-todo' : 'text-done'"
      >
        {{ importMessage.text }}
      </p>
    </section>

    <hr class="m-0 h-0 border-0 border-t-2 border-t-bevel-dk" />

    <section class="flex flex-col gap-2">
      <h2 class="m-0 font-display text-[19px] leading-tight">Credits</h2>

      <!-- Fan Content Policy §8.1 requires this wording verbatim, in a
           prominent and visible place. Do not paraphrase it. -->
      <p class="m-0 max-w-[52ch] text-[15px]">
        Created using intellectual property belonging to Jagex Limited under the
        terms of Jagex's Fan Content Policy. This content is not endorsed by or
        affiliated with Jagex.
      </p>

      <ul
        class="m-0 flex list-none flex-col gap-1 p-0 text-[15px] text-ink-soft"
      >
        <li>Skill icons are Jagex's, via the OSRS Wiki</li>
        <!-- Names every dataset, not just quests: this line is where the
             licence's attribution reaches the reader, so it has to stay
             true as datasets are added. -->
        <li>Quest, diary and boss data from the OSRS Wiki, CC BY-NC-SA 3.0</li>
        <li>Icons from game-icons.net, CC BY 3.0, and Phosphor, MIT</li>
        <li>IM Fell English and Alegreya Sans, SIL Open Font License</li>
      </ul>

      <p class="m-0 max-w-[52ch] text-[15px] text-ink-soft">
        Curator's Journal reads public data only. It is not a third-party client
        and never touches the game.
      </p>
    </section>
  </div>
</template>
