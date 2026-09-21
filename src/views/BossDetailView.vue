<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { pageHeader } from '@/composables/usePageHeader'
import { useBossesStore } from '@/stores/bosses'
import { useBossDetailStore } from '@/stores/bossDetail'

/*
 * Full-panel boss detail: what it is, how the fight goes, what it drops.
 *
 * Structured like QuestDetailView rather than as a stack of cards: a lede of
 * meta and the one player-owned number, then chapters (`font-display`, with a
 * rule) holding sections (small bold headings) of flat rows. The first version
 * of this page was five bevel boxes in a column with headings at one size and
 * bare paragraphs between them, which read as a pile rather than a page.
 *
 * Reached from the Bosses list. The header title and back button live in the
 * shell (App.vue) — see `usePageHeader`.
 */
const props = defineProps<{ id: string }>()

const bosses = useBossesStore()
const detail = useBossDetailStore()

onMounted(() => void bosses.ensureReady())

const boss = computed(() => bosses.bosses.find((b) => b.id === props.id))
const row = computed(() => bosses.rows.find((r) => r.boss.id === props.id))

/*
 * Detail is keyed by page, so a variant reads its parent's file: The Corrupted
 * Gauntlet has its own kill count but shares The Gauntlet's page and therefore
 * its drops and prose. Fetching `id` here would ask for a file that was
 * deliberately never written.
 */
const detailId = computed(() => boss.value?.variantOf ?? props.id)

watch(
  detailId,
  (id) => {
    if (id) void detail.ensureDetail(id)
  },
  { immediate: true },
)

const table = computed(() => detail.byId[detailId.value] ?? null)
const detailLoading = computed(() => !!detail.loading[detailId.value])
const detailFailed = computed(() => !!detail.failed[detailId.value])

const totalDrops = computed(
  () => table.value?.tables.reduce((n, t) => n + t.drops.length, 0) ?? 0,
)

/** True when the page documents more than one form with its own drop table. */
const hasSeveralVersions = computed(() => {
  const seen = new Set<string>()
  for (const t of table.value?.tables ?? []) if (t.version) seen.add(t.version)
  return seen.size > 1
})

/*
 * The page-level facts, as labelled rows.
 *
 * **Labelled, not a meta line.** Quests get away with a bare
 * "Hard · Long · 5 qp · F2P" because those are conventions a player reads
 * instantly. A boss's equivalents are not: "Ungael" and "Blue Dragons,
 * Zombies" are unreadable without being told what they are, which is what the
 * first version of this did.
 *
 * Separate from the version stat blocks below because these belong to the
 * boss rather than to a form of it — inside one, a location read as though
 * that form were somewhere the other wasn't.
 */
const about = computed(() => {
  const b = boss.value
  if (!b) return []

  const rows: { label: string; value: string }[] = []
  if (b.locations.length) {
    rows.push({
      label: b.locations.length > 1 ? 'Locations' : 'Location',
      value: b.locations.join(' · '),
    })
  }
  if (b.slayerCategories.length) {
    rows.push({
      label:
        b.slayerCategories.length > 1 ? 'Slayer categories' : 'Slayer category',
      value: b.slayerCategories.join(', '),
    })
  }
  rows.push({ label: 'Members', value: b.members ? 'Yes' : 'No' })
  return rows
})

/*
 * Which sections are collapsed lives in the query string, not in a ref.
 *
 * Same rule as the quest walkthrough's expansion, and it earns its keep for
 * the same reason: this is a page you have open *while playing*, so it is
 * sitting there when iOS kills the backgrounded PWA. A `ref` would come back
 * with every section reopened — or worse, reset to defaults — each time you
 * swapped to the game and back.
 *
 * **Closed** sections are stored rather than open ones, so the default URL is
 * clean and a boss opens fully expanded. `replace`, not `push`: collapsing a
 * section is not a place you should have to press Back out of.
 */
const route = useRoute()
const router = useRouter()

function parseClosed(value: unknown): Set<string> {
  return new Set(
    String(value ?? '')
      .split(',')
      .filter(Boolean),
  )
}

/*
 * Held in a ref *and* mirrored to the URL, rather than read straight back out
 * of `route.query`.
 *
 * Reading the query directly loses a toggle when two land in the same tick:
 * `router.replace` doesn't update `route` synchronously, so the second tap
 * computes its new set from the pre-first-tap value and overwrites it. Two
 * quick taps on different headings is enough — measured, not theorised.
 *
 * The URL stays the thing that survives a relaunch; the watch takes changes
 * that come from outside this component, such as Back or a cold launch on a
 * deep link.
 */
const closed = ref(parseClosed(route.query.closed))
watch(
  () => route.query.closed,
  (value) => {
    closed.value = parseClosed(value)
  },
)

function isOpen(key: string): boolean {
  return !closed.value.has(key)
}

function toggle(key: string): void {
  const next = new Set(closed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  closed.value = next

  const query = { ...route.query }
  if (next.size) query.closed = [...next].join(',')
  else delete query.closed
  void router.replace({ query })
}

/*
 * The header is set here and cleared on unmount, per usePageHeader: Vue Router
 * reuses this component when moving from one boss straight to another, so the
 * title has to follow the id rather than being set once on mount.
 */
watch(
  boss,
  (b) => {
    pageHeader.value = { title: b?.name ?? 'Boss', backTo: '/bosses' }
  },
  { immediate: true },
)
onUnmounted(() => {
  pageHeader.value = null
})
</script>

<template>
  <div v-if="!boss" class="p-3">
    <p class="m-0 text-[15px] text-ink-soft">
      <template v-if="bosses.loading">Loading…</template>
      <template v-else>No boss with that id.</template>
    </p>
  </div>

  <div v-else class="flex flex-col gap-4 p-3">
    <!-- Lede: the one number on this page that belongs to the player rather
         than to the boss. It carries its own label in the word "kills", so it
         needs no row. -->
    <section class="flex flex-col gap-1">
      <!-- The three states, said in words rather than implied by a number:
           untracked is not zero, and an absent score really is zero because
           every boss appears on the hiscores from the first kill. -->
      <p v-if="!row?.tracked" class="m-0 text-[15px] text-ink-soft">
        The hiscores publish no kill count for this boss.
      </p>
      <p v-else-if="!bosses.countsKnown" class="m-0 text-[15px] text-ink-soft">
        Add your username in Stats to see your kill count.
      </p>
      <p v-else class="m-0 flex items-baseline gap-2">
        <span class="nums text-[19px] font-bold text-ink">
          {{ (row?.kills ?? 0).toLocaleString() }} kills
        </span>
        <span v-if="row?.rank !== null" class="text-[13px] text-ink-soft">
          rank <span class="nums">{{ row?.rank?.toLocaleString() }}</span>
        </span>
      </p>

      <p v-if="boss.variantOf" class="m-0 text-[13px] text-ink-soft">
        A harder mode, counted separately by the hiscores. Stats and drops are
        shared with the base encounter.
      </p>
    </section>

    <!-- Flavour, in the same place a quest puts its description: context
         before the detail, not a footnote after it. -->
    <p v-if="boss.examine" class="m-0 text-[15px] italic text-ink-soft">
      “{{ boss.examine }}”
    </p>

    <!-- "Appears in", never "Requires": the wiki field says where the NPC
         turns up, which for a quest boss is a fight you have during it rather
         than a gate you pass first.

         Its own box rather than a row inside About, because it is the one
         thing on this page you can go *to* — and it stays inside the app,
         which is the whole reason it's worth making obvious. `bg-parchment`
         on a `parchment` body, so the box reads as a raised plate of the same
         material rather than a sunken field like the rows below. -->
    <RouterLink
      v-for="quest in boss.questAppearances"
      :key="quest.id"
      :to="`/quests/${quest.id}`"
      class="tap pressable-parchment bevel flex items-center justify-between gap-3 bg-parchment px-3 no-underline"
    >
      <span class="flex min-w-0 items-baseline gap-2">
        <span class="shrink-0 text-[13px] text-ink-soft">Appears in</span>
        <span class="min-w-0 truncate text-[15px] font-bold text-ink">
          {{ quest.name }}
        </span>
      </span>
      <AppIcon
        name="chevron"
        :size="12"
        class="shrink-0 text-ink-soft"
        aria-hidden="true"
      />
    </RouterLink>

    <!-- Facts about the boss itself, labelled and in the same flat rows the
         stats and drops use. -->
    <section class="flex flex-col">
      <!-- The heading is the control. `.pressable-parchment`, not
           `.pressable`: the latter hard-codes brown tones and would repaint a
           parchment row under the thumb. -->
      <h2 class="m-0">
        <button
          type="button"
          class="tap pressable-parchment -ml-1 flex w-full items-center gap-1.5 pl-1 text-left text-[13px] font-bold text-ink-soft"
          :aria-expanded="isOpen('about')"
          @click="toggle('about')"
        >
          <AppIcon
            name="caretDown"
            :size="11"
            class="shrink-0 transition-transform"
            :class="isOpen('about') ? '' : '-rotate-90'"
            aria-hidden="true"
          />
          About
        </button>
      </h2>
      <!-- Indented to the caret, so the rows read as belonging to the heading
           rather than sitting beside it. -->
      <ul v-if="isOpen('about')" class="m-0 flex list-none flex-col p-0 pl-4">
        <li
          v-for="fact in about"
          :key="fact.label"
          class="flex items-baseline justify-between gap-3 border-b-2 border-b-bevel-dk/20 py-2 pl-2 pr-1"
        >
          <span class="shrink-0 text-[14px] text-ink-soft">
            {{ fact.label }}
          </span>
          <span class="min-w-0 text-right text-[14px] text-ink">
            {{ fact.value }}
          </span>
        </li>
      </ul>
    </section>

    <!-- Chapter: everything about fighting it — the numbers and the
         behaviour, which answer one question together. -->
    <div
      v-if="boss.versions.length || table?.overview.length"
      class="flex flex-col gap-4"
    >
      <div class="flex items-baseline gap-2.5">
        <p class="font-display m-0 text-[19px] text-ink">The fight</p>
        <span class="h-px min-w-4 flex-1 bg-bevel-dk/30" aria-hidden="true" />
      </div>

      <!-- One section per version, headed by the wiki's own label. A boss with
           two forms gets two, rather than one merged block stating numbers
           neither form has. -->
      <section
        v-for="(version, i) in boss.versions"
        :key="i"
        class="flex flex-col"
      >
        <h2 class="m-0">
          <button
            type="button"
            class="tap pressable-parchment -ml-1 flex w-full items-center gap-1.5 pl-1 text-left text-[13px] font-bold text-ink-soft"
            :aria-expanded="isOpen(`s${i}`)"
            @click="toggle(`s${i}`)"
          >
            <AppIcon
              name="caretDown"
              :size="11"
              class="shrink-0 transition-transform"
              :class="isOpen(`s${i}`) ? '' : '-rotate-90'"
              aria-hidden="true"
            />
            {{ version.label ?? 'Stats' }}
          </button>
        </h2>
        <!-- Flat rows, not `.bevel-in` boxes — that bevel reads as a pressed
             control, which is wrong for inert data. Same call as the quest
             requirement rows. -->
        <ul v-if="isOpen(`s${i}`)" class="m-0 flex list-none flex-col p-0 pl-4">
          <li
            v-for="stat in [
              { label: 'Combat level', value: version.combatLevel },
              { label: 'Hitpoints', value: version.hitpoints },
              { label: 'Slayer level', value: version.slayerLevel },
              { label: 'Attack speed', value: version.attackSpeed },
              {
                label: 'Attacks with',
                value: version.attackStyles.join(', ') || null,
              },
              { label: 'Max hit', value: version.maxHit },
            ].filter((s) => s.value !== null && s.value !== '')"
            :key="stat.label"
            class="flex items-baseline justify-between gap-3 border-b-2 border-b-bevel-dk/20 py-2 pl-2 pr-1"
          >
            <span class="shrink-0 text-[14px] text-ink-soft">
              {{ stat.label }}
            </span>
            <span class="nums min-w-0 text-right text-[14px] text-ink">
              {{ stat.value }}
            </span>
          </li>
        </ul>
      </section>

      <section v-if="table?.overview.length" class="flex flex-col">
        <h2 class="m-0">
          <button
            type="button"
            class="tap pressable-parchment -ml-1 flex w-full items-center gap-1.5 pl-1 text-left text-[13px] font-bold text-ink-soft"
            :aria-expanded="isOpen('mechanics')"
            @click="toggle('mechanics')"
          >
            <AppIcon
              name="caretDown"
              :size="11"
              class="shrink-0 transition-transform"
              :class="isOpen('mechanics') ? '' : '-rotate-90'"
              aria-hidden="true"
            />
            Mechanics
          </button>
        </h2>
        <div v-if="isOpen('mechanics')" class="flex flex-col gap-2 pl-4 pt-1.5">
          <p
            v-for="(para, i) in table.overview"
            :key="i"
            class="m-0 text-[15px] leading-snug text-ink"
          >
            {{ para }}
          </p>
        </div>
      </section>
    </div>

    <!-- Chapter: the loot. -->
    <div class="flex flex-col gap-4">
      <div class="flex items-baseline gap-2.5">
        <p class="font-display m-0 text-[19px] text-ink">
          Drops<template v-if="totalDrops">
            <span class="nums text-[15px] text-ink-soft">
              · {{ totalDrops }}
            </span>
          </template>
        </p>
        <span class="h-px min-w-4 flex-1 bg-bevel-dk/30" aria-hidden="true" />
      </div>

      <p v-if="detailLoading" class="m-0 text-[15px] text-ink-soft">
        Loading drops…
      </p>
      <!-- "Couldn't load" and "has none" are different sentences on purpose:
           one is worth a retry and the other never will be. -->
      <p v-else-if="detailFailed" class="m-0 text-[15px] text-ink-soft">
        Couldn't load the drop table. It may not have been cached yet.
      </p>
      <p
        v-else-if="!table?.tables.length"
        class="m-0 text-[15px] text-ink-soft"
      >
        The wiki documents no drop table for this boss.
      </p>

      <template v-else>
        <p v-if="hasSeveralVersions" class="m-0 text-[13px] text-ink-soft">
          This boss has more than one form and they drop different things — each
          table says which.
        </p>

        <section v-for="(t, i) in table.tables" :key="i" class="flex flex-col">
          <h2 class="m-0">
            <button
              type="button"
              class="tap pressable-parchment -ml-1 flex w-full items-center gap-1.5 pl-1 text-left text-[13px] font-bold text-ink-soft"
              :aria-expanded="isOpen(`d${i}`)"
              @click="toggle(`d${i}`)"
            >
              <AppIcon
                name="caretDown"
                :size="11"
                class="shrink-0 transition-transform"
                :class="isOpen(`d${i}`) ? '' : '-rotate-90'"
                aria-hidden="true"
              />
              {{ t.section ?? 'Drops' }}
              <span v-if="t.version" class="font-normal"
                >· {{ t.version }}</span
              >
              <!-- The count stays visible when collapsed: it is the reason to
                   open one table rather than another. -->
              <span class="nums font-normal text-ink-soft/70">
                ({{ t.drops.length }})
              </span>
            </button>
          </h2>
          <ul
            v-if="isOpen(`d${i}`)"
            class="m-0 flex list-none flex-col p-0 pl-4"
          >
            <li
              v-for="(drop, j) in t.drops"
              :key="j"
              class="flex items-baseline justify-between gap-3 border-b-2 border-b-bevel-dk/20 py-2 pl-2 pr-1"
            >
              <span class="min-w-0 flex-1 text-[14px] text-ink">
                {{ drop.name }}
                <span v-if="drop.quantity" class="nums text-ink-soft">
                  ×{{ drop.quantity }}
                </span>
              </span>
              <!-- A rarity the wiki computes with a template can't be read
                   here, and an em dash is the honest rendering: a truncated
                   fraction would look like a rate. -->
              <!-- "· 2 rolls", not "×2": beside a fraction, a bare ×2 reads as
                   multiplying the rate rather than saying the table is rolled
                   twice. -->
              <span class="nums shrink-0 text-[13px] text-ink-soft">
                {{ drop.rarity ?? '—' }}
                <template v-if="drop.rolls">
                  · {{ drop.rolls }} rolls
                </template>
              </span>
            </li>
          </ul>
        </section>
      </template>
    </div>

    <a
      :href="boss.wikiUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="tap pressable bevel-oak engraved flex w-fit items-center gap-2 bg-brown px-3.5 font-bold text-gold no-underline"
    >
      Read on the wiki
      <AppIcon name="external" :size="14" />
    </a>
  </div>
</template>
