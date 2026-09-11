<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { pageHeader } from '@/composables/usePageHeader'
import { combatLevel } from '@/lib/quests'
import type { QuestProgress } from '@/lib/quests'
import type { SkillRequirement } from '@/lib/types'
import { useQuestsStore } from '@/stores/quests'

/*
 * Full-panel quest detail: everything the engine knows about one quest,
 * reachable from the Quests panel's list (Queue joins once it has real rows
 * to tap — 4e). The header title and back button live in the shell
 * (App.vue), not here — see `usePageHeader` for why.
 */
const props = defineProps<{ id: string }>()

const quests = useQuestsStore()
onMounted(() => void quests.ensureReady())

const quest = computed(() => quests.index.byId.get(props.id))
const status = computed(() =>
  quest.value ? quests.statuses.get(quest.value.id) : undefined,
)

// Watches `quest`, not just mount: Vue Router reuses this component when
// navigating from one quest straight to another (a prerequisite link below),
// since only the `:id` param changes — a mount-only title would go stale.
watch(
  quest,
  (q) => {
    pageHeader.value = { title: q?.name ?? 'Quest', backTo: '/quests' }
  },
  { immediate: true },
)
onUnmounted(() => {
  pageHeader.value = null
})

const haveCombat = computed(() => combatLevel(quests.levels))

const PROGRESS_OPTIONS: { value: QuestProgress; label: string }[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'doing', label: 'Doing' },
  { value: 'done', label: 'Done' },
]

function prereqName(id: string): string {
  return quests.index.byId.get(id)?.name ?? id
}

/**
 * `null` means unknown, not zero — the whole reason `evaluateQuest` reports
 * `have: null` instead of defaulting it. A skill missing from `quests.levels`
 * only happens when there's no snapshot at all (every ranked *and* unranked
 * skill is present once one loads), so this only ever reads unknown when
 * `levelsKnown` is false — never per individual skill.
 */
function haveLevel(skill: SkillRequirement['skill']): number | null {
  return quests.levels[skill] ?? null
}

function skillMet(req: SkillRequirement): boolean {
  const have = haveLevel(req.skill)
  return have !== null && have >= req.level
}

/**
 * Same map and meaning as the Quests-panel list — a prerequisite's current
 * progress, not what this quest requires of it (that's the text alongside).
 * A standalone stripe, not a `border-l` on the row itself, for the same
 * reason as the list: the row is a real oak button (`bevel-oak`) now, and a
 * status border layered on that class risks a cascade fight with its own.
 */
const STATUS_STRIPE: Record<QuestProgress, string> = {
  todo: 'bg-todo',
  doing: 'bg-doing',
  done: 'bg-done',
}

function statusStripeClass(id: string): string {
  return STATUS_STRIPE[quests.progressOf(id)]
}
</script>

<template>
  <div class="flex flex-col gap-4 p-3">
    <p v-if="quests.loading" class="m-0 text-[15px] text-ink-soft">
      Loading quest…
    </p>

    <!-- Ids come from wiki page titles, so a wiki rename orphans a saved
         completion — see ROADMAP.md. Rare, but a dead link must say so
         rather than render blank. -->
    <template v-else-if="!quest">
      <p class="m-0 text-[15px] text-ink-soft">Quest not found.</p>
      <RouterLink
        to="/quests"
        class="tap pressable bevel-oak flex w-fit items-center gap-2 bg-brown px-3.5 font-bold text-gold engraved"
      >
        <AppIcon name="back" :size="14" />
        Back to Quests
      </RouterLink>
    </template>

    <template v-else>
      <section class="flex flex-col gap-1">
        <p class="nums m-0 text-[13px] text-ink-soft">
          {{ quest.difficulty ?? 'Unknown difficulty' }}
          <template v-if="quest.length"> &middot; {{ quest.length }}</template>
          &middot; {{ quest.questPoints }} qp
          <template v-if="!quest.members">&middot; F2P</template>
          <template v-if="quest.group"> &middot; {{ quest.group }}</template>
        </p>

        <p
          class="m-0 text-[15px] font-bold"
          :class="
            status?.progress === 'done'
              ? 'text-done'
              : status?.canStart
                ? 'text-done'
                : 'text-todo'
          "
        >
          {{
            status?.progress === 'done'
              ? 'Completed'
              : status?.canStart
                ? 'You can start this now'
                : 'Blocked — see requirements below'
          }}
        </p>
      </section>

      <!-- Direct selection, not the single-tap cycle the list row was built
           for: here there's room to show all three states and choose one,
           which reads clearer than cycling through it blind. -->
      <section class="flex flex-col gap-1.5">
        <h2 class="m-0 text-[13px] font-bold text-ink-soft">Progress</h2>
        <div class="flex gap-1.5">
          <button
            v-for="opt in PROGRESS_OPTIONS"
            :key="opt.value"
            type="button"
            class="tap pressable bevel-oak flex-1 px-3 text-[13px] font-bold"
            :class="
              status?.progress === opt.value
                ? 'bevel-oak-in bg-brown text-gold engraved'
                : 'bg-brown-lt text-parchment-3'
            "
            @click="quests.setProgress(quest.id, opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </section>

      <section
        v-if="quest.requirements.skills.length"
        class="flex flex-col gap-1.5"
      >
        <h2 class="m-0 text-[13px] font-bold text-ink-soft">Skills</h2>
        <!-- Flat rows with a colored left edge, not `.bevel-in` boxes — that
             bevel reads as a pressed/interactive control (it's what the
             search input uses), which is wrong for inert data. The edge
             color reuses the todo/doing/done vocabulary loosely: green for
             met, red for unmet-and-blocks-starting, amber for unmet-but-not-
             blocking, and the bevel-dk neutral when the level itself is
             unknown — genuinely a fourth state, not "assume blocked". -->
        <ul class="m-0 flex list-none flex-col p-0">
          <li
            v-for="req in quest.requirements.skills"
            :key="req.skill"
            class="flex items-center border-b-2 border-b-bevel-dk/20 border-l-4 py-2 pl-2 pr-1"
            :class="
              skillMet(req)
                ? 'border-l-done'
                : haveLevel(req.skill) === null
                  ? 'border-l-bevel-dk'
                  : req.requiredToStart === true
                    ? 'border-l-todo'
                    : 'border-l-doing'
            "
          >
            <div class="min-w-0 flex-1">
              <div class="text-[15px] leading-tight">
                {{ req.skill }} <span class="nums">{{ req.level }}</span>
              </div>
              <div class="truncate text-[12px] text-ink-soft">
                <template v-if="haveLevel(req.skill) !== null">
                  Have <span class="nums">{{ haveLevel(req.skill) }}</span>
                  &middot;
                </template>
                <template v-else>Level unknown &middot; </template>
                <template v-if="req.requiredToStart === true">
                  required to start
                </template>
                <template v-else-if="req.requiredToStart === false">
                  required to finish
                </template>
                <template v-else>unclear if this blocks starting</template>
                <template v-if="req.boostable === true">
                  &middot; boostable</template
                >
                <template v-else-if="req.boostable === false">
                  &middot; not boostable
                </template>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <section
        v-if="quest.requirements.quests.length"
        class="flex flex-col gap-1.5"
      >
        <h2 class="m-0 text-[13px] font-bold text-ink-soft">Quests</h2>
        <!-- The stripe is this prerequisite's *current* progress — the same
             red/amber/green the rest of the app uses. A struck-through name
             says "done" on its own, checklist-style, needing no reading — so
             the trailing "Needs finished/started" text only shows while
             that's still true; once satisfied it would be redundant next to
             the strikethrough, not clarifying. Each row is a real oak
             button, matching the list's row treatment (see QuestsView.vue) —
             no separate button competes for space in this row, so unlike
             there, the chevron just nests directly in the link. -->
        <ul class="m-0 flex flex-col gap-1.5 p-0">
          <li
            v-for="prereq in quest.requirements.quests"
            :key="prereq.id"
            class="flex items-stretch"
          >
            <span
              class="w-1 shrink-0"
              :class="statusStripeClass(prereq.id)"
              aria-hidden="true"
            />

            <RouterLink
              :to="`/quests/${prereq.id}`"
              class="tap pressable bevel-oak flex min-w-0 flex-1 items-center gap-2 bg-brown-lt py-1.5 pl-3 pr-3 no-underline"
            >
              <span
                class="min-w-0 flex-1 truncate text-[15px] font-bold text-gold engraved"
                :class="
                  quests.progressOf(prereq.id) === 'done' && 'line-through'
                "
              >
                {{ prereqName(prereq.id) }}
              </span>
              <span
                v-if="quests.progressOf(prereq.id) !== 'done'"
                class="shrink-0 text-[12px] text-parchment-3"
              >
                Needs
                {{ prereq.completion === 'started' ? 'started' : 'finished' }}
              </span>
              <AppIcon
                name="chevron"
                :size="12"
                class="ml-1 shrink-0 text-gold"
                aria-hidden="true"
              />
            </RouterLink>
          </li>
        </ul>
      </section>

      <section
        v-if="quest.requirements.questPoints !== undefined"
        class="flex flex-col gap-1.5"
      >
        <h2 class="m-0 text-[13px] font-bold text-ink-soft">Quest points</h2>
        <p class="nums m-0 text-[15px]">
          Need {{ quest.requirements.questPoints }}, have
          {{ quests.questPoints }}
        </p>
      </section>

      <section
        v-if="quest.requirements.combatLevel !== undefined"
        class="flex flex-col gap-1.5"
      >
        <h2 class="m-0 text-[13px] font-bold text-ink-soft">Combat level</h2>
        <p class="nums m-0 text-[15px]">
          Need {{ quest.requirements.combatLevel }}, have
          {{ haveCombat ?? 'unknown' }}
        </p>
      </section>

      <section v-if="quest.notes.length" class="flex flex-col gap-1.5">
        <h2 class="m-0 text-[13px] font-bold text-ink-soft">
          The wiki also requires
        </h2>
        <p class="m-0 text-[13px] text-ink-soft">
          Free text the engine can't check — read these before assuming this
          quest is truly startable.
        </p>
        <ul class="m-0 flex list-none flex-col gap-1 p-0 text-[15px]">
          <li v-for="(note, i) in quest.notes" :key="i">{{ note }}</li>
        </ul>
      </section>

      <a
        :href="quest.wikiUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="tap pressable bevel-oak mt-1 flex w-fit items-center gap-2 bg-brown-lt px-3.5 text-[13px] font-bold text-parchment-3"
      >
        <AppIcon name="external" :size="14" />
        View on the OSRS Wiki
      </a>
    </template>
  </div>
</template>
