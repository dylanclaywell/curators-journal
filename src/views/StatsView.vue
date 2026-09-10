<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useHiscoresStore } from '@/stores/hiscores'
import { useSettingsStore } from '@/stores/settings'
import type { AccountType } from '@/lib/types'

const settings = useSettingsStore()
const hiscores = useHiscoresStore()

const draft = ref('')

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
  void hiscores.load(settings.username, settings.accountType)
}

watch(
  () => settings.accountType,
  (type) => {
    if (settings.username) void hiscores.load(settings.username, type)
  },
)

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
    <form class="flex flex-col gap-2" @submit.prevent="submit">
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

      <button
        type="submit"
        class="tap pressable bevel-oak flex items-center justify-center gap-2 bg-brown font-bold text-gold engraved"
      >
        <AppIcon name="search" :size="15" />
        Look up
      </button>
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
        <div class="flex items-baseline justify-between gap-2">
          <span class="font-display text-[20px]">{{
            hiscores.snapshot.displayName
          }}</span>
          <span class="nums text-[15px] text-ink-soft">{{ asOf }}</span>
        </div>
        <dl class="m-0 grid grid-cols-3 gap-2">
          <div class="flex flex-col">
            <dt class="text-[13px] font-bold text-ink-soft">Total</dt>
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
        </dl>
      </div>

      <!-- 2c replaces this with the designed skills grid. -->
      <ul class="m-0 flex list-none flex-col p-0">
        <li
          v-for="skill in hiscores.snapshot.skills"
          :key="skill.name"
          class="flex items-baseline justify-between gap-2 border-b border-bevel-dk/40 py-1.5"
        >
          <span class="text-[15px]">{{ skill.name }}</span>
          <span class="nums text-[16px] font-bold">{{ skill.level }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>
