<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import QuestItemLines from '@/components/QuestItemLines.vue'
import { pageHeader } from '@/composables/usePageHeader'
import { combatLevel, prerequisiteChain } from '@/lib/quests'
import type { QuestProgress } from '@/lib/quests'
import type { SkillRequirement } from '@/lib/types'
import { panelById } from '@/panels/registry'
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

/*
 * This view is mounted under two paths — `/quests/:id` and `/queue/:id` — and
 * the difference is which panel you came from. Back has to return there: a plan
 * row opened from the Queue that dropped you into the 214-row quest list would
 * be sending you somewhere you'd never been.
 *
 * Read from `meta.panelId` rather than tracked in a variable, because the path
 * is the only form of this that survives the app being killed in the
 * background, which iOS does to a home-screen PWA.
 */
const route = useRoute()
const fromPanel = computed(
  () => panelById(String(route.meta.panelId ?? '')) ?? panelById('quests')!,
)

/** Keeps a tap from one quest to another inside the panel you started in. */
function detailPath(id: string): string {
  return `${fromPanel.value.path}/${id}`
}

// Watches `quest`, not just mount: Vue Router reuses this component when
// navigating from one quest straight to another (a prerequisite link below),
// since only the `:id` param changes — a mount-only title would go stale.
watch(
  [quest, fromPanel],
  ([q, panel]) => {
    pageHeader.value = { title: q?.name ?? 'Quest', backTo: panel.path }
  },
  { immediate: true },
)
onUnmounted(() => {
  pageHeader.value = null
})

const haveCombat = computed(() => combatLevel(quests.levels))

/**
 * Every quest behind this one, direct and transitive, in dependency order.
 * Structural, so it doesn't depend on progress — only the stripes and the
 * remaining count do.
 */
const chain = computed(() =>
  quest.value ? prerequisiteChain(quest.value.id, quests.index) : [],
)

const chainRemaining = computed(
  () =>
    chain.value.filter((step) => quests.progressOf(step.quest.id) !== 'done')
      .length,
)

/*
 * A long chain is collapsed by default. Dragon Slayer II has 35 quests behind
 * it and Defeating the Culinaromancer 47 — rendered whole, that's a wall of oak
 * between the quest's status and everything below it, and vertical space is the
 * scarce resource in the docked case. Truncating is safe *because* the order is
 * dependency order: the first rows are the ones to do first, so a cut tail is
 * the distant future rather than an arbitrary slice.
 */
const CHAIN_COLLAPSE_OVER = 10
const CHAIN_COLLAPSED_ROWS = 6

const chainExpanded = ref(false)
// Reset when routing from one quest straight to another; the component is
// reused, so expansion would otherwise carry over to an unrelated chain.
watch(quest, () => {
  chainExpanded.value = false
})

const chainCollapsible = computed(
  () => chain.value.length > CHAIN_COLLAPSE_OVER,
)
const visibleChain = computed(() =>
  chainCollapsible.value && !chainExpanded.value
    ? chain.value.slice(0, CHAIN_COLLAPSED_ROWS)
    : chain.value,
)

/**
 * 4g's four added fields turned quest detail into a run of same-weight
 * sections with no way to tell them apart at a glance. Grouping them into
 * three chapters — what gates starting, what to bring, what you get — splits
 * that up without hiding anything or adding a tap. The chapter title below
 * borrows the journal's own serif display face, a second and heavier
 * hierarchy level above the existing bold section labels, so a chapter break
 * reads before any of its content does.
 */
const hasWhatItTakes = computed(
  () =>
    !!quest.value &&
    (quest.value.requirements.skills.length > 0 ||
      chain.value.length > 0 ||
      quest.value.requirements.questPoints !== undefined ||
      quest.value.requirements.combatLevel !== undefined ||
      quest.value.notes.length > 0),
)
const hasBeforeYouGo = computed(
  () =>
    !!quest.value &&
    (quest.value.kills.length > 0 ||
      quest.value.itemsRequired.length > 0 ||
      quest.value.itemsRecommended.length > 0),
)
const hasWhenItsDone = computed(
  () => !!quest.value && quest.value.rewards.length > 0,
)

const PROGRESS_OPTIONS: { value: QuestProgress; label: string }[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'doing', label: 'Doing' },
  { value: 'done', label: 'Done' },
]

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
        :to="fromPanel.path"
        class="tap pressable bevel-oak flex w-fit items-center gap-2 bg-brown px-3.5 font-bold text-gold engraved"
      >
        <AppIcon name="back" :size="14" />
        Back to {{ fromPanel.title }}
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

      <!-- Flavor text and the start point, straight from the wiki's own
           fields. Shown before Progress/Queue: it's context for the decision
           those make, not a result of it. -->
      <section
        v-if="quest.description.length || quest.startPoint"
        class="flex flex-col gap-1.5"
      >
        <p
          v-for="(paragraph, i) in quest.description"
          :key="i"
          class="m-0 text-[15px]"
        >
          {{ paragraph }}
        </p>
        <p v-if="quest.startPoint" class="m-0 text-[13px] text-ink-soft">
          Start: {{ quest.startPoint }}
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

      <!-- Queueing belongs here, not only on the list row it landed on in 4c.
           Curating the queue is a Quests-panel activity — the Queue panel has
           no "add" of its own, because a button that silently moves you to
           another tab reads as one action when it's really a mode change. So
           the flow is: search, open a quest, read why it's hard, decide, add,
           go back for the next one. Without a toggle here, that flow dead-ends
           at the moment you've decided. -->
      <section class="flex flex-col gap-1.5">
        <h2 class="m-0 text-[13px] font-bold text-ink-soft">Queue</h2>
        <button
          type="button"
          class="tap pressable bevel-oak flex w-full items-center justify-center gap-2 px-3 font-bold"
          :class="
            quests.isGoal(quest.id)
              ? 'bevel-oak-in bg-brown text-gold engraved'
              : 'bg-brown-lt text-parchment-3'
          "
          @click="quests.toggleGoal(quest.id)"
        >
          <AppIcon
            :name="quests.isGoal(quest.id) ? 'check' : 'plus'"
            :size="15"
          />
          {{ quests.isGoal(quest.id) ? 'In your queue' : 'Add to queue' }}
        </button>
        <!-- Says what queueing actually does, because it isn't obvious that
             one goal can pull in dozens of quests behind it. -->
        <p
          v-if="!quests.isGoal(quest.id)"
          class="m-0 text-[13px] text-ink-soft"
        >
          Curator's Journal works backwards from this and everything it needs.
        </p>
      </section>

      <!-- Chapter: everything that gates `canStart`/`canFinish`, plus the
           free-text requirements no program can check (`notes`) — grouped
           because they answer one question, "am I actually eligible", even
           though only some of them are computable. -->
      <div v-if="hasWhatItTakes" class="flex flex-col gap-4">
        <div class="flex items-baseline gap-2.5">
          <p class="font-display m-0 text-[19px] text-ink">What it takes</p>
          <span class="h-px min-w-4 flex-1 bg-bevel-dk/30" aria-hidden="true" />
        </div>

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

        <section v-if="chain.length" class="flex flex-col gap-1.5">
          <h2 class="m-0 text-[13px] font-bold text-ink-soft">Quests first</h2>
          <!-- The whole chain, not just what this quest names directly: A Night
             at the Theatre lists one prerequisite and hides six behind it, and
             tapping through them one at a time was the thing that made the
             page read as thin. Done quests stay in the list rather than being
             filtered out the way `buildPlan` filters them — a completed chain
             rendered empty would say "nothing was ever required here". -->
          <p class="m-0 text-[13px] text-ink-soft">
            <template v-if="chainRemaining === 0">
              All <span class="nums">{{ chain.length }}</span> done.
            </template>
            <template v-else>
              <span class="nums">{{ chainRemaining }}</span> of
              <span class="nums">{{ chain.length }}</span> still to do, in this
              order.
            </template>
          </p>
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
              v-for="step in visibleChain"
              :key="step.quest.id"
              class="flex items-stretch"
            >
              <span
                class="w-1 shrink-0"
                :class="statusStripeClass(step.quest.id)"
                aria-hidden="true"
              />

              <RouterLink
                :to="detailPath(step.quest.id)"
                class="tap pressable bevel-oak flex min-w-0 flex-1 items-center gap-2 bg-brown-lt py-1.5 pl-3 pr-3 no-underline"
              >
                <span
                  class="min-w-0 flex-1 truncate text-[15px] font-bold text-gold engraved"
                  :class="
                    quests.progressOf(step.quest.id) === 'done' &&
                    'line-through'
                  "
                >
                  {{ step.quest.name }}
                </span>
                <!-- Only on a direct prerequisite. "Needs finished" describes
                   what *this* quest asks for; on a quest that's here because
                   an ancestor needs it, the same words would attribute the
                   requirement to the wrong quest. -->
                <span
                  v-if="
                    step.completion &&
                    quests.progressOf(step.quest.id) !== 'done'
                  "
                  class="shrink-0 text-[12px] text-parchment-3"
                >
                  Needs
                  {{ step.completion === 'started' ? 'started' : 'finished' }}
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

          <!-- The secondary oak treatment the wiki link below uses, not the
             chain rows' gold: it's a control over the list rather than another
             entry in it. Parchment was the first instinct and is wrong twice —
             buttons are oak here, and `.pressable` hard-codes an oak press
             state that would flip a parchment button brown under the thumb. -->
          <button
            v-if="chainCollapsible"
            type="button"
            class="tap pressable bevel-oak flex w-full items-center justify-center gap-2 bg-brown-lt px-3 text-[13px] font-bold text-parchment-3"
            @click="chainExpanded = !chainExpanded"
          >
            {{
              chainExpanded
                ? 'Show fewer'
                : `Show all ${chain.length} — ${chain.length - CHAIN_COLLAPSED_ROWS} more`
            }}
          </button>
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
      </div>

      <!-- Chapter: what to bring, not what's checked against anything —
           monsters, required items, and recommendations all fail the same
           way if flattened into "What it takes" above: none of them gate
           `canStart`, so grouping them with what does would say they do. -->
      <div v-if="hasBeforeYouGo" class="flex flex-col gap-4">
        <div class="flex items-baseline gap-2.5">
          <p class="font-display m-0 text-[19px] text-ink">Before you go</p>
          <span class="h-px min-w-4 flex-1 bg-bevel-dk/30" aria-hidden="true" />
        </div>

        <!-- Monsters, not items: kept separate from the two item lists below
           because it answers a different question ("what will I fight"),
           same as `notes` is separate from `requirements.skills`. -->
        <section v-if="quest.kills.length" class="flex flex-col gap-1.5">
          <h2 class="m-0 text-[13px] font-bold text-ink-soft">
            Monsters to kill
          </h2>
          <QuestItemLines :lines="quest.kills" :levels="quests.levels" />
        </section>

        <!-- Items sit below the checkable requirements and above the wiki link:
           they're what you act on once you've decided the quest is startable,
           not part of deciding it. Neither list gates anything, so neither
           carries a status color — see QuestItemLines.vue. -->
        <section
          v-if="quest.itemsRequired.length"
          class="flex flex-col gap-1.5"
        >
          <h2 class="m-0 text-[13px] font-bold text-ink-soft">Items needed</h2>
          <QuestItemLines
            :lines="quest.itemsRequired"
            :levels="quests.levels"
          />
        </section>

        <!-- Not a second item list: the wiki's `recommended` also carries combat
           levels, travel routes and inventory-space advice, so the heading says
           "Recommended" rather than promising items. Muted because it's
           advisory — the required list above is the one that blocks you. -->
        <section
          v-if="quest.itemsRecommended.length"
          class="flex flex-col gap-1.5"
        >
          <h2 class="m-0 text-[13px] font-bold text-ink-soft">Recommended</h2>
          <QuestItemLines
            :lines="quest.itemsRecommended"
            :levels="quests.levels"
            muted
          />
        </section>
      </div>

      <!-- Chapter: the payoff, on its own — nothing above gates on it and
           nothing below it needs to be read first. -->
      <div v-if="hasWhenItsDone" class="flex flex-col gap-4">
        <div class="flex items-baseline gap-2.5">
          <p class="font-display m-0 text-[19px] text-ink">When it's done</p>
          <span class="h-px min-w-4 flex-1 bg-bevel-dk/30" aria-hidden="true" />
        </div>

        <!-- `colorLevels` is off — see QuestItemLines.vue — a reward line's
           leading number is an XP amount, not a level to compare against the
           player's own. -->
        <section v-if="quest.rewards.length" class="flex flex-col gap-1.5">
          <h2 class="m-0 text-[13px] font-bold text-ink-soft">Rewards</h2>
          <QuestItemLines
            :lines="quest.rewards"
            :levels="quests.levels"
            :colorLevels="false"
          />
        </section>
      </div>

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
