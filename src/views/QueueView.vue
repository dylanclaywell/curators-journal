<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useQuestsStore } from '@/stores/quests'

/*
 * The queue panel (4e): what to do next, and the ordered plan behind it.
 *
 * The panel leads with what's *startable*, not with the plan, because a plan is
 * long — Dragon Slayer II alone expands to 36 steps and two goals to 44 — and
 * the queue's question is "what am I doing next", asked repeatedly mid-session
 * with the game on screen above. A 36-row list is an answer to a different
 * question, so it sits underneath, collapsed.
 *
 * Everything here reads the store; the ordering and expansion are `buildPlan`'s,
 * unchanged since 4a.
 */
const quests = useQuestsStore()

// Dataset *and* levels. The panel used to load only the dataset, which meant a
// cold load here showed no levels until Stats had been visited.
onMounted(() => void quests.ensureReady())

/** How many actionable steps to surface before the plan itself. */
const NEXT_UP_LIMIT = 3

/*
 * The plan and the goals are two different workflows, not two halves of one
 * view: the plan is read-only and answers "what do I do next", while the goals
 * list is where you change what you're aiming at. Shown together they also read
 * as redundant, because every goal appears in both — Dragon Slayer II sits at
 * step 36 of its own plan.
 *
 * So they share the space rather than stacking, which also buys back the height
 * a second list costs. "Next up" stays above the switch: it's the reason the
 * app gets swapped to, and it must not be a click away.
 *
 * Not persisted — nothing in the app persists UI state yet, and this belongs
 * with that job (active panel, scroll position, current step) rather than
 * getting its own one-off key. See ROADMAP.md.
 */
type QueueTab = 'plan' | 'goals'
const tab = ref<QueueTab>('plan')

/*
 * The plan is ordered, so the first startable steps are genuinely the ones to
 * do next rather than an arbitrary pick. `canStart` is only meaningful once
 * levels exist — with no snapshot every skill reads as unknown — so this is
 * gated on `levelsKnown` rather than quietly presenting guesses as answers.
 */
const nextUp = computed(() =>
  quests.levelsKnown
    ? quests.plan.filter((step) => step.status.canStart).slice(0, NEXT_UP_LIMIT)
    : [],
)

const startableInPlan = computed(() =>
  quests.levelsKnown
    ? quests.plan.filter((step) => step.status.canStart).length
    : null,
)

/*
 * Same treatment as the prerequisite chain on quest detail, for the same
 * reason: a 36-row wall buries everything under it, and vertical space is the
 * scarce resource in the docked case. Safe to truncate only because the order
 * is dependency order — the visible rows are the near future.
 */
const PLAN_COLLAPSE_OVER = 8
const PLAN_COLLAPSED_ROWS = 5

const planExpanded = ref(false)
// A plan that shrinks under an expanded list (a goal removed, a quest marked
// done) would otherwise leave the toggle showing "Show fewer" over a short list.
watch(
  () => quests.plan.length,
  (length) => {
    if (length <= PLAN_COLLAPSE_OVER) planExpanded.value = false
  },
)

const planCollapsible = computed(() => quests.plan.length > PLAN_COLLAPSE_OVER)
const visiblePlan = computed(() =>
  planCollapsible.value && !planExpanded.value
    ? quests.plan.slice(0, PLAN_COLLAPSED_ROWS)
    : quests.plan,
)

/** Goals in the player's own order — which is now the plan's order too. */
const goalQuests = computed(() =>
  quests.goals.flatMap((id) => {
    const quest = quests.index.byId.get(id)
    return quest ? [quest] : []
  }),
)

/*
 * Counts live in the tabs so the hidden side still reports itself — the whole
 * cost of splitting the view is that half of it is out of sight, and a bare
 * "Goals" label would hide whether there are two or none.
 */
const TABS = computed<{ value: QueueTab; label: string; count: number }[]>(
  () => [
    { value: 'plan', label: 'Plan', count: quests.plan.length },
    { value: 'goals', label: 'Goals', count: goalQuests.value.length },
  ],
)

const total = computed(() => quests.index.all.length)

/**
 * Startable across the whole dataset, for the empty state only — once a queue
 * exists, "startable in your plan" is the more useful number and this would
 * just compete with it.
 *
 * Null rather than 0 when levels are unknown: with no snapshot every skill
 * reads as unknown, so a count here would answer "we don't know your levels"
 * with a confident number.
 */
const startableAnywhere = computed(() => {
  if (!quests.levelsKnown) return null
  let count = 0
  for (const status of quests.statuses.values()) {
    if (status.progress !== 'done' && status.canStart) count++
  }
  return count
})
</script>

<template>
  <div class="flex flex-col gap-4 p-3">
    <!-- An empty panel is an invitation, not a blank. -->
    <template v-if="quests.goals.length === 0">
      <div class="flex flex-col items-start gap-3">
        <AppIcon name="scroll" :size="40" class="text-ink-soft" />
        <p class="m-0 font-display text-[19px] leading-tight">
          Your queue is empty
        </p>
        <p class="m-0 max-w-[46ch] text-ink-soft">
          Pick a quest in the Quests tab and Curator's Journal works backwards
          through everything it needs, then tells you what you can start right
          now.
        </p>
        <!-- The one place the Queue links to Quests, and it names a
             destination rather than promising an action: with nothing queued
             there's no session to lose, and a first run needs a way forward.
             Once the queue has anything in it this button is gone, and the tab
             bar is the way across. -->
        <RouterLink
          to="/quests"
          class="tap pressable bevel-oak mt-1 flex items-center gap-2 bg-brown px-3.5 font-bold text-gold no-underline engraved"
        >
          <AppIcon name="openBook" :size="15" />
          Browse quests
        </RouterLink>

        <!-- Useful on its own while the queue is empty, and proof the data
             path works. Three states, not two: a username that's set but
             still resolving must not be told to set a username. -->
        <p
          v-if="total"
          class="nums m-0 mt-1 border-t-2 border-bevel-dk pt-3 text-[15px] text-ink-soft"
        >
          <template v-if="startableAnywhere !== null">
            <strong class="font-bold text-ink">{{ startableAnywhere }}</strong>
            of {{ total }} quests startable now
          </template>
          <template v-else-if="quests.awaitingLevels">
            {{ total }} quests loaded — checking your levels
          </template>
          <template v-else>
            {{ total }} quests loaded — add your username in Stats to see which
            you can start
          </template>
        </p>
      </div>
    </template>

    <template v-else>
      <!-- The panel's reason to exist: the shortest honest answer to "what
           now". Rows are the primary oak (`bg-brown`), a step up from the
           plan's `bg-brown-lt` below, because this is the thing you came to
           read. -->
      <section class="flex flex-col gap-1.5">
        <h2 class="m-0 text-[13px] font-bold text-ink-soft">Next up</h2>

        <template v-if="nextUp.length">
          <ul class="m-0 flex flex-col gap-1.5 p-0">
            <li
              v-for="step in nextUp"
              :key="step.quest.id"
              class="flex items-stretch"
            >
              <span
                class="w-1 shrink-0"
                :class="
                  quests.progressOf(step.quest.id) === 'doing'
                    ? 'bg-doing'
                    : 'bg-done'
                "
                aria-hidden="true"
              />
              <RouterLink
                :to="`/queue/${step.quest.id}`"
                class="tap pressable bevel-oak flex min-w-0 flex-1 items-center gap-2 bg-brown py-1.5 pl-3 pr-3 no-underline"
              >
                <span
                  class="min-w-0 flex-1 truncate text-[15px] font-bold text-gold engraved"
                >
                  {{ step.quest.name }}
                </span>
                <AppIcon
                  name="chevron"
                  :size="12"
                  class="ml-1 shrink-0 text-gold"
                  aria-hidden="true"
                />
              </RouterLink>

              <!-- The mid-session loop, and the reason this panel exists: you
                   finish a quest with the game still open above, and want the
                   next one without a round trip through its detail page.
                   Marking progress used to cost four interactions and two
                   navigations from here.

                   The label is the *transition*, not the state — `buildPlan`
                   drops finished quests, so a row here is only ever todo or
                   doing and there is no third case to decode. "Leads on" gave
                   up its place: at the 375px floor a name, a hint and a real
                   tap target don't fit, and an action beats an annotation on
                   the one row you came to act on. -->
              <button
                type="button"
                class="tap pressable bevel-oak ml-1.5 flex shrink-0 items-center justify-center px-3 text-[13px] font-bold"
                :class="
                  quests.progressOf(step.quest.id) === 'doing'
                    ? 'bg-brown-lt text-done'
                    : 'bg-brown-lt text-parchment-3'
                "
                :aria-label="
                  quests.progressOf(step.quest.id) === 'doing'
                    ? `Mark ${step.quest.name} finished`
                    : `Mark ${step.quest.name} started`
                "
                @click="
                  quests.setProgress(
                    step.quest.id,
                    quests.progressOf(step.quest.id) === 'doing'
                      ? 'done'
                      : 'doing',
                  )
                "
              >
                {{
                  quests.progressOf(step.quest.id) === 'doing'
                    ? 'Finish'
                    : 'Start'
                }}
              </button>
            </li>
          </ul>
        </template>

        <!-- Three states, not two: a username that's set but still resolving
             must not be told to set a username, and neither may be told
             "nothing is startable" when the truth is that we can't tell. -->
        <p
          v-else-if="quests.awaitingLevels"
          class="m-0 text-[15px] text-ink-soft"
        >
          Checking your levels…
        </p>
        <p
          v-else-if="!quests.levelsKnown"
          class="m-0 text-[15px] text-ink-soft"
        >
          Add your username in Stats and this will show what you can start.
        </p>
        <p v-else class="m-0 text-[15px] text-ink-soft">
          Nothing in the plan is startable yet — the steps below are blocked on
          quests rather than levels.
        </p>
      </section>

      <!-- Selected is dark oak with gold, unselected is pale parchment, which
           is the vocabulary the rest of the app already speaks: the shell's
           tab bar and quest detail's progress switcher both mark the chosen
           option that way. A tab strip that inverted it would be the one
           control in the app where dark meant "not this one".

           The contrast is deliberately much stronger than the progress
           switcher's, because the thing that changes here is the whole panel
           below rather than one field, and it has to be readable at a glance
           with the game on screen above.

           `.pressable-parchment` rather than `.pressable` on the unselected
           tabs: the latter hard-codes oak tones and would repaint a parchment
           tab brown under the thumb. -->
      <div class="flex flex-col gap-1.5">
        <div class="flex gap-1.5" role="tablist" aria-label="Queue view">
          <button
            v-for="option in TABS"
            :key="option.value"
            type="button"
            role="tab"
            :aria-selected="tab === option.value"
            :aria-controls="`queue-${option.value}`"
            class="tap flex-1 px-3 text-[13px] font-bold"
            :class="
              tab === option.value
                ? 'pressable bevel-oak-in bg-brown text-gold engraved'
                : 'pressable-parchment bevel bg-parchment-2 text-ink'
            "
            @click="tab = option.value"
          >
            {{ option.label }}
            <span class="nums font-normal">({{ option.count }})</span>
          </button>
        </div>

        <!-- The panel is a real surface with its own ground and bevel, so the
             rows inside clearly belong to the selected tab rather than
             floating on the page. -->
        <div class="bevel bg-parchment-2 p-2.5">
          <section
            v-if="tab === 'plan'"
            id="queue-plan"
            role="tabpanel"
            class="flex flex-col gap-1.5"
          >
            <!-- A plan can be empty while goals exist: `buildPlan` drops finished
             quests, so completing everything you aimed at empties it. That's
             the good ending, and it must read as one rather than as a bug. -->
            <p v-if="!quests.plan.length" class="m-0 text-[15px]">
              Everything you're aiming at is done. Pick another in the Quests
              tab to keep going.
            </p>

            <p v-else class="m-0 text-[13px] text-ink-soft">
              <span class="nums">{{ quests.plan.length }}</span>
              {{ quests.plan.length === 1 ? 'quest' : 'quests' }} left, in
              order.
              <template v-if="startableInPlan !== null">
                <span class="nums">{{ startableInPlan }}</span> startable now.
              </template>
            </p>

            <ul class="m-0 flex flex-col gap-1.5 p-0">
              <li
                v-for="(step, i) in visiblePlan"
                :key="step.quest.id"
                class="flex items-stretch"
              >
                <!-- Green when it's startable, amber when it isn't. Not red: a
                 blocked step is waiting its turn in a plan that already
                 orders it, which is the system working rather than a
                 problem. Neutral while levels are unknown. -->
                <span
                  class="w-1 shrink-0"
                  :class="
                    !quests.levelsKnown
                      ? 'bg-bevel-dk'
                      : step.status.canStart
                        ? 'bg-done'
                        : 'bg-doing'
                  "
                  aria-hidden="true"
                />
                <RouterLink
                  :to="`/queue/${step.quest.id}`"
                  class="tap pressable bevel-oak flex min-w-0 flex-1 items-center gap-2 bg-brown-lt py-1.5 pl-3 pr-3 no-underline"
                >
                  <span class="nums shrink-0 text-[12px] text-parchment-3">{{
                    i + 1
                  }}</span>
                  <span
                    class="min-w-0 flex-1 truncate text-[15px] font-bold text-gold engraved"
                  >
                    {{ step.quest.name }}
                  </span>
                  <!-- Marks the quests you actually asked for. Worth showing: "I
                   never picked this" is a fair question about a 36-step plan. -->
                  <AppIcon
                    v-if="step.goal"
                    name="scroll"
                    :size="13"
                    class="shrink-0 text-parchment-3"
                    aria-label="One of your goals"
                  />
                  <AppIcon
                    name="chevron"
                    :size="12"
                    class="ml-1 shrink-0 text-gold"
                    aria-hidden="true"
                  />
                </RouterLink>
              </li>
            </ul>

            <button
              v-if="planCollapsible"
              type="button"
              class="tap pressable bevel-oak flex w-full items-center justify-center gap-2 bg-brown-lt px-3 text-[13px] font-bold text-parchment-3"
              @click="planExpanded = !planExpanded"
            >
              {{
                planExpanded
                  ? 'Show fewer'
                  : `Show all ${quests.plan.length} — ${quests.plan.length - PLAN_COLLAPSED_ROWS} more`
              }}
            </button>
          </section>

          <section
            v-else
            id="queue-goals"
            role="tabpanel"
            class="flex flex-col gap-1.5"
          >
            <p class="m-0 text-[13px] text-ink-soft">
              What you're aiming at. The plan works backwards from these.
            </p>

            <TransitionGroup
              tag="ul"
              name="goal"
              class="m-0 flex flex-col gap-1.5 p-0"
            >
              <li
                v-for="(goal, i) in goalQuests"
                :key="goal.id"
                class="flex items-stretch gap-1.5"
              >
                <!-- Side by side, not stacked: `.tap`'s 44px floor applies
                 per button, so stacking would double this row's height
                 against every other row in the list, and vertical space is
                 the scarce resource in the docked case. Disabled rather than
                 hidden at either end, so the row's width doesn't shift as
                 you reorder. -->
                <div class="flex shrink-0 gap-0.5">
                  <button
                    type="button"
                    class="tap pressable bevel-oak flex items-center justify-center bg-brown-lt px-2 text-parchment-3 disabled:opacity-40"
                    :disabled="i === 0"
                    :aria-label="`Move ${goal.name} up`"
                    @click="quests.moveGoal(goal.id, 'up')"
                  >
                    <AppIcon name="arrowUp" :size="13" />
                  </button>
                  <button
                    type="button"
                    class="tap pressable bevel-oak flex items-center justify-center bg-brown-lt px-2 text-parchment-3 disabled:opacity-40"
                    :disabled="i === goalQuests.length - 1"
                    :aria-label="`Move ${goal.name} down`"
                    @click="quests.moveGoal(goal.id, 'down')"
                  >
                    <AppIcon name="arrowDown" :size="13" />
                  </button>
                </div>

                <RouterLink
                  :to="`/queue/${goal.id}`"
                  class="tap pressable bevel-oak flex min-w-0 flex-1 items-center gap-2 bg-brown-lt py-1.5 pl-3 pr-3 no-underline"
                >
                  <span
                    class="min-w-0 flex-1 truncate text-[15px] font-bold text-gold engraved"
                    :class="
                      quests.progressOf(goal.id) === 'done' && 'line-through'
                    "
                  >
                    {{ goal.name }}
                  </span>
                </RouterLink>

                <!-- An X, not a bin: removing a goal drops it from the queue and
                 leaves the quest and its recorded progress untouched. -->
                <button
                  type="button"
                  class="tap pressable bevel-oak flex shrink-0 items-center justify-center bg-brown-lt px-3 text-parchment-3"
                  :aria-label="`Remove ${goal.name} from your queue`"
                  @click="quests.removeGoal(goal.id)"
                >
                  <AppIcon name="x" :size="14" />
                </button>
              </li>
            </TransitionGroup>

            <!-- No "add" button here on purpose. Adding is a Quests-panel
                 activity: you search, open a quest, read it, decide. A button
                 on this panel promises a single action and instead hands you
                 to another tab for an open-ended session you never return
                 from. The Quests tab is one tap away in the bar regardless. -->
            <p class="m-0 text-[13px] text-ink-soft">
              Add more from the Quests tab.
            </p>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>
