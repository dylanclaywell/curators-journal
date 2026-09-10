<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { MAX_LEVEL, xpToNextLevel } from '@/lib/hiscores'
import { useHiscoresStore } from '@/stores/hiscores'
import { useSettingsStore } from '@/stores/settings'
import type { AccountType, SkillEntry } from '@/lib/types'

const settings = useSettingsStore()
const hiscores = useHiscoresStore()

const draft = ref('')

/**
 * The lookup form costs ~200px of height. That's affordable in a tall window
 * and ruinous in the docked case, where the whole panel is ~420px and the
 * levels would sit entirely below the fold. So once there's a snapshot the form
 * collapses to a one-line identity row and only reappears on request.
 */
const editing = ref(false)

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'normal', label: 'Main' },
  { value: 'ironman', label: 'Ironman' },
  { value: 'hardcore', label: 'Hardcore ironman' },
  { value: 'ultimate', label: 'Ultimate ironman' },
  { value: 'skiller', label: 'Skiller' },
  { value: 'skiller_defence', label: 'Skiller (1 def)' },
  { value: 'deadman', label: 'Deadman' },
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'tournament', label: 'Tournament' },
]

// Settings hydrate asynchronously, so seed the input once they arrive and
// look up whatever was saved last session.
watch(
  () => settings.hydrated,
  (ready) => {
    if (!ready) return
    draft.value = settings.username
    if (settings.username) {
      void hiscores.load(settings.username, settings.accountType)
    }
  },
  { immediate: true },
)

function submit() {
  settings.username = draft.value.trim()
  if (!settings.username) return
  editing.value = false
  void hiscores.load(settings.username, settings.accountType)
}

function refresh() {
  if (settings.username)
    void hiscores.load(settings.username, settings.accountType)
}

function cancelEdit() {
  editing.value = false
  draft.value = settings.username
}

const accountLabel = computed(
  () =>
    ACCOUNT_TYPES.find((t) => t.value === settings.accountType)?.label ??
    settings.accountType,
)

watch(
  () => settings.accountType,
  (type) => {
    if (settings.username) void hiscores.load(settings.username, type)
  },
)

/** Untrained *and* off the board — worth dimming rather than showing a bold 1. */
function isUntouched(skill: SkillEntry): boolean {
  return skill.rank === null && skill.level <= 1
}

/** Fill fraction for the next-level bar; nothing to show once a skill is maxed. */
function progressPercent(skill: SkillEntry): number | null {
  if (skill.level >= MAX_LEVEL) return null
  const next = xpToNextLevel(skill.xp)
  if (!next) return null
  return Math.round(next.progress * 100)
}

const asOf = computed(() => {
  const at = hiscores.snapshot?.fetchedAt
  if (!at) return ''
  const minutes = Math.round((Date.now() - at) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
})
</script>

<template>
  <div class="flex flex-col gap-3 p-3">
    <!-- Collapsed identity row: who we're showing, how old it is, and the two
         actions worth reaching for. Replaces ~200px of form so the levels are
         visible without scrolling in a shallow docked panel. -->
    <div v-if="hiscores.snapshot && !editing" class="flex items-center gap-2">
      <div class="min-w-0 flex-1">
        <div class="truncate font-mono text-[15px] leading-tight">
          {{ hiscores.snapshot.displayName }}
        </div>
        <div class="truncate text-[13px] text-ink-soft">
          {{ accountLabel }} &middot; {{ asOf }}
        </div>
      </div>
      <button
        type="button"
        aria-label="Refresh levels"
        class="tap pressable bevel-oak flex w-11 items-center justify-center bg-brown text-gold"
        @click="refresh"
      >
        <AppIcon name="refresh" :size="16" />
      </button>
      <button
        type="button"
        aria-label="Change account"
        class="tap pressable bevel-oak flex w-11 items-center justify-center bg-brown text-gold"
        @click="editing = true"
      >
        <AppIcon name="pencil" :size="16" />
      </button>
    </div>

    <form v-else class="flex flex-col gap-2" @submit.prevent="submit">
      <label class="flex flex-col gap-1">
        <span class="text-[15px] font-bold">Username</span>
        <!-- Monospace deliberately: OSRS names collide on l / 1 / I / |, and a
             humanist face renders a lowercase L and a pipe identically. -->
        <input
          v-model="draft"
          type="text"
          inputmode="text"
          autocapitalize="none"
          autocomplete="off"
          spellcheck="false"
          maxlength="20"
          placeholder="Zezima"
          class="tap bevel-in bg-parchment-2 px-2 font-mono text-[16px] text-ink placeholder:text-ink-soft/60"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-[15px] font-bold">Account type</span>
        <!-- The chevron is ours, not the UA's: a native select arrow sits hard
             against the border and is a different shape and colour on every
             platform. Still a real <select>, so iOS keeps its picker wheel. -->
        <div class="relative flex">
          <select
            v-model="settings.accountType"
            class="tap bevel-in w-full appearance-none bg-parchment-2 pl-2 pr-10 font-body text-[16px] text-ink"
          >
            <option v-for="t in ACCOUNT_TYPES" :key="t.value" :value="t.value">
              {{ t.label }}
            </option>
          </select>
          <AppIcon
            name="caretDown"
            :size="13"
            class="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-soft"
          />
        </div>
      </label>

      <div class="flex gap-2">
        <button
          type="submit"
          class="tap pressable bevel-oak flex flex-1 items-center justify-center gap-2 bg-brown font-bold text-gold engraved"
        >
          <AppIcon name="search" :size="15" />
          Look up
        </button>
        <!-- Only offered when there's something to go back to. -->
        <button
          v-if="hiscores.snapshot"
          type="button"
          class="tap pressable bevel-oak bg-brown px-4 font-bold text-parchment-3 engraved"
          @click="cancelEdit"
        >
          Cancel
        </button>
      </div>
    </form>

    <p
      v-if="hiscores.status === 'loading'"
      class="m-0 text-[15px] text-ink-soft"
    >
      Reading the hiscores…
    </p>

    <!-- An error with no data to fall back on. -->
    <p
      v-else-if="hiscores.status === 'error' && hiscores.error"
      class="m-0 text-[15px] text-todo"
    >
      {{ hiscores.error.message }}
    </p>

    <template v-if="hiscores.snapshot">
      <!-- Stale banner: a failed refresh leaves the old levels on screen
           rather than blanking the panel, so it has to say so. -->
      <p
        v-if="hiscores.stale && hiscores.error"
        class="m-0 text-[15px] text-doing"
      >
        {{ hiscores.error.message }} Showing the last known levels.
      </p>

      <div class="bevel-in flex flex-col gap-1 bg-parchment-2 px-3 py-2">
        <!-- Name and age live in the identity row above, not repeated here. -->
        <!-- Wraps rather than using breakpoints: four short figures reflow
             fine on their own at any panel width. -->
        <dl class="m-0 flex flex-wrap gap-x-6 gap-y-2">
          <div class="flex flex-col">
            <dt class="text-[13px] font-bold text-ink-soft">Total level</dt>
            <dd class="nums m-0 text-[19px]">
              {{ hiscores.snapshot.overall.level }}
            </dd>
          </div>
          <div class="flex flex-col">
            <dt class="text-[13px] font-bold text-ink-soft">Combat</dt>
            <dd class="nums m-0 text-[19px]">{{ hiscores.combat }}</dd>
          </div>
          <div class="flex flex-col">
            <dt class="text-[13px] font-bold text-ink-soft">Total XP</dt>
            <dd class="nums m-0 text-[19px]">
              {{ hiscores.snapshot.overall.xp.toLocaleString() }}
            </dd>
          </div>
          <div class="flex flex-col">
            <dt class="text-[13px] font-bold text-ink-soft">Rank</dt>
            <dd class="nums m-0 text-[19px]">
              {{
                hiscores.snapshot.overall.rank === null
                  ? 'Unranked'
                  : hiscores.snapshot.overall.rank.toLocaleString()
              }}
            </dd>
          </div>
        </dl>
      </div>

      <!-- No Jagex skill icons here, deliberately (see Licensing in CLAUDE.md),
           so the cells are text-forward: name above, level below. -->
      <div class="skill-grid">
        <div
          v-for="skill in hiscores.snapshot.skills"
          :key="skill.name"
          class="flex flex-col justify-between gap-1 bg-parchment px-2 py-1.5"
          :class="isUntouched(skill) && 'opacity-55'"
        >
          <span class="truncate text-[13px] leading-tight text-ink-soft">{{
            skill.name
          }}</span>
          <span
            class="nums text-[19px] font-bold leading-none"
            :class="skill.level >= MAX_LEVEL && 'text-done'"
            >{{ skill.level }}</span
          >
          <!-- Reserve the bar's height even when there's nothing to draw, so
               maxed and unmaxed cells keep the same baseline. -->
          <div
            class="skill-bar"
            :class="!progressPercent(skill) && 'invisible'"
          >
            <i :style="{ width: `${progressPercent(skill) ?? 0}%` }"></i>
          </div>
        </div>
      </div>

      <p class="m-0 text-[13px] text-ink-soft">
        Levels at 99 are marked in green. The bar under each level is progress
        towards the next one.
      </p>
    </template>
  </div>
</template>
