/**
 * The diary engine's job is to be honest about four distinctions the data
 * makes and a naive reading would flatten:
 *
 *   - a tier's own requirements versus the requirements of the tasks in it,
 *     which the wiki maintains separately and which genuinely disagree;
 *   - completing a tier versus claiming its rewards, where only the second is
 *     gated on the tiers below;
 *   - what the player has *done* versus what the data says they *can* do,
 *     which are independent and must not override each other;
 *   - a level we know is too low versus a level we have no snapshot for.
 *
 * Each has a failure mode that is invisible in the UI — a tier shown as
 * blocked when it is workable, or ready when it is not, or a completion
 * silently discarded — so they are what these tests are for. The shared
 * requirement checking is `quests.ts`'s and is not re-tested here.
 */
import { describe, expect, it } from 'vitest'
import { buildIndex } from '../src/lib/quests'
import { SKILL_NAMES } from '../src/lib/types'
import type { PlayerState } from '../src/lib/quests'
import {
  buildDiaryIndex,
  completableNow,
  diaryCompletion,
  evaluateDiary,
  evaluateDiaryTier,
  expandTiers,
  mergeDoneTasks,
  taskIdsOf,
  tierProgressFrom,
} from '../src/lib/diaries'
import type { DiaryTaskMap } from '../src/lib/diaries'
import { taskIdFor } from '../src/lib/task-id'
import type { Diary, DiaryTask, DiaryTier, Quest } from '../src/lib/types'

const quest = (id: string, questPoints = 1): Quest =>
  ({
    id,
    name: id,
    difficulty: 'Novice',
    length: 'Short',
    questPoints,
    members: true,
    miniquest: false,
    group: null,
    requirements: { skills: [], quests: [] },
    notes: [],
    description: [],
    startPoint: '',
    kills: [],
    rewards: [],
    itemsRequired: [],
    itemsRecommended: [],
    wikiUrl: '',
  }) as Quest

/** Ids come from the real helper, so the tests exercise the shipped scheme. */
const task = (tierId: string, text: string, over: Partial<DiaryTask> = {}) => ({
  id: taskIdFor(tierId, text),
  text,
  requirements: { skills: [], quests: [] },
  items: [],
  notes: [],
  ...over,
})

const tier = (
  id: string,
  name: DiaryTier['tier'],
  over: Partial<DiaryTier> = {},
): DiaryTier => ({
  id,
  tier: name,
  requirements: { skills: [], quests: [] },
  tasks: [task(id, 'first thing'), task(id, 'second thing')],
  notes: [],
  rewards: [],
  ...over,
})

const diary = (tiers: DiaryTier[]): Diary => ({
  id: 'ardougne',
  name: 'Ardougne Diary',
  areas: ['Ardougne'],
  members: true,
  taskmaster: 'Two-pints',
  tiers,
  wikiUrl: '',
})

const quests = buildIndex([quest('rune-mysteries'), quest('biohazard')])

const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  levels: {},
  progress: {},
  ...over,
})

/** Every task in these tiers, checked. */
const allDone = (...tiers: DiaryTier[]): DiaryTaskMap =>
  Object.fromEntries(tiers.flatMap(taskIdsOf).map((id) => [id, true]))

const AGILITY_90 = {
  skills: [
    {
      skill: 'Agility' as const,
      level: 90,
      boostable: null,
      requiredToStart: null,
    },
  ],
  quests: [],
}

describe('tierProgressFrom', () => {
  const t = tier('ardougne-easy', 'Easy')

  it('is todo with nothing checked', () => {
    expect(tierProgressFrom(t, {})).toBe('todo')
  })

  it('is doing with some checked', () => {
    expect(tierProgressFrom(t, { [t.tasks[0].id]: true })).toBe('doing')
  })

  it('is done with all checked', () => {
    expect(tierProgressFrom(t, allDone(t))).toBe('done')
  })

  it('is todo, not done, when a tier has no tasks at all', () => {
    // An empty tier means the dataset failed to parse one. Reporting that as
    // complete would be the worst available answer — it hides the defect and
    // credits the player with work they never did.
    const empty = tier('ardougne-easy', 'Easy', { tasks: [] })
    expect(tierProgressFrom(empty, {})).toBe('todo')
  })
})

describe('evaluateDiaryTier', () => {
  it('reports a tier as completable when its requirements are met', () => {
    const t = tier('ardougne-easy', 'Easy', {
      requirements: {
        skills: [
          {
            skill: 'Thieving',
            level: 5,
            boostable: null,
            requiredToStart: null,
          },
        ],
        quests: [{ id: 'rune-mysteries', completion: 'finished' }],
      },
    })
    const status = evaluateDiaryTier(
      diary([t]),
      t,
      player({
        levels: { Thieving: 10 },
        progress: { 'rune-mysteries': 'done' },
      }),
      quests,
      {},
    )

    expect(status.canComplete).toBe(true)
    expect(status.unmet.unmetSkills).toEqual([])
    expect(status.progress).toBe('todo')
    expect(status.doneTasks).toBe(0)
    expect(status.totalTasks).toBe(2)
  })

  it('distinguishes an unknown level from one that is too low', () => {
    const t = tier('ardougne-easy', 'Easy', {
      requirements: {
        skills: [
          {
            skill: 'Thieving',
            level: 50,
            boostable: null,
            requiredToStart: null,
          },
        ],
        quests: [],
      },
    })

    const noSnapshot = evaluateDiaryTier(diary([t]), t, player(), quests, {})
    expect(noSnapshot.unmet.unmetSkills[0].have).toBeNull()

    const tooLow = evaluateDiaryTier(
      diary([t]),
      t,
      player({ levels: { Thieving: 20 } }),
      quests,
      {},
    )
    expect(tooLow.unmet.unmetSkills[0].have).toBe(20)
  })

  it('counts blocked tasks even when the tier itself is clear', () => {
    // The wiki maintains tier totals and task cells separately, so this really
    // happens. Reporting only the tier would call it ready.
    const t = tier('ardougne-medium', 'Medium')
    t.tasks[1] = task(t.id, 'hard thing', { requirements: AGILITY_90 })

    const status = evaluateDiaryTier(diary([t]), t, player(), quests, {})
    expect(status.canComplete).toBe(true)
    expect(status.blockedTasks).toBe(1)
    expect(status.tasks[0].canComplete).toBe(true)
    expect(status.tasks[1].canComplete).toBe(false)
  })

  it('satisfies a "started" quest prerequisite with an in-progress quest', () => {
    const t = tier('ardougne-medium', 'Medium', {
      requirements: {
        skills: [],
        quests: [{ id: 'biohazard', completion: 'started' }],
      },
    })
    const status = evaluateDiaryTier(
      diary([t]),
      t,
      player({ progress: { biohazard: 'doing' } }),
      quests,
      {},
    )
    expect(status.canComplete).toBe(true)
  })
})

describe('done and doable are independent', () => {
  const t = tier('ardougne-hard', 'Hard')
  t.tasks[1] = task(t.id, 'hard thing', { requirements: AGILITY_90 })

  it('keeps a task checked even when its requirements read as unmet', () => {
    // The requirements are the wiki's opinion; the check is the player's
    // record of what they actually did. The app must not overrule the player
    // about their own history — a boost, an update, or a wiki error all
    // produce this state legitimately.
    const status = evaluateDiaryTier(diary([t]), t, player(), quests, {
      [t.tasks[1].id]: true,
    })
    expect(status.tasks[1].done).toBe(true)
    expect(status.tasks[1].canComplete).toBe(false)
  })

  it('stops counting a finished task as blocked work remaining', () => {
    const before = evaluateDiaryTier(diary([t]), t, player(), quests, {})
    expect(before.blockedTasks).toBe(1)

    const after = evaluateDiaryTier(diary([t]), t, player(), quests, {
      [t.tasks[1].id]: true,
    })
    expect(after.blockedTasks).toBe(0)
  })

  it('reaches done through tasks the requirements say are impossible', () => {
    const status = evaluateDiaryTier(
      diary([t]),
      t,
      player(),
      quests,
      allDone(t),
    )
    expect(status.progress).toBe('done')
    // Still not doable on paper — no Agility snapshot, and task 2 wants 90 —
    // yet the tier is finished, because the player says so.
    expect(status.tasks[1].canComplete).toBe(false)
    expect(status.tasks[1].done).toBe(true)
  })
})

describe('reward claiming versus completion', () => {
  const tiers = [
    tier('ardougne-easy', 'Easy'),
    tier('ardougne-medium', 'Medium'),
    tier('ardougne-hard', 'Hard'),
    tier('ardougne-elite', 'Elite'),
  ]

  it('does not gate completing a tier on the tiers below it', () => {
    const status = evaluateDiaryTier(
      diary(tiers),
      tiers[2],
      player(),
      quests,
      {},
    )
    // Nothing done below, yet the tasks are still doable in any order.
    expect(status.canComplete).toBe(true)
  })

  it('reports the tiers below that block claiming the rewards', () => {
    const status = evaluateDiaryTier(
      diary(tiers),
      tiers[2],
      player(),
      quests,
      allDone(tiers[0]),
    )
    expect(status.rewardsBlockedBy).toEqual(['Medium'])
  })

  it('reports nothing blocking once every tier below is done', () => {
    const status = evaluateDiaryTier(
      diary(tiers),
      tiers[3],
      player(),
      quests,
      allDone(tiers[0], tiers[1], tiers[2]),
    )
    expect(status.rewardsBlockedBy).toEqual([])
  })

  it('does not count a partly-finished tier as done for reward claiming', () => {
    const status = evaluateDiaryTier(diary(tiers), tiers[1], player(), quests, {
      [tiers[0].tasks[0].id]: true,
    })
    expect(status.rewardsBlockedBy).toEqual(['Easy'])
  })
})

describe('completableNow', () => {
  it('omits tiers already done and tiers still blocked', () => {
    const tiers = [
      tier('ardougne-easy', 'Easy'),
      tier('ardougne-medium', 'Medium', { requirements: AGILITY_90 }),
      tier('ardougne-hard', 'Hard'),
      tier('ardougne-elite', 'Elite'),
    ]
    const index = buildDiaryIndex([diary(tiers)])
    const ready = completableNow(
      index,
      player(),
      quests,
      allDone(tiers[2]), // Hard finished
    )

    expect(ready.map((t) => t.id)).toEqual(['ardougne-easy', 'ardougne-elite'])
  })
})

describe('diaryCompletion', () => {
  it('counts finished tiers and finished tasks separately', () => {
    const tiers = [
      tier('ardougne-easy', 'Easy'),
      tier('ardougne-medium', 'Medium'),
    ]
    const index = buildDiaryIndex([diary(tiers)])

    expect(diaryCompletion(index, allDone(tiers[0]))).toEqual({
      tiers: 1,
      totalTiers: 2,
      tasks: 2,
      totalTasks: 4,
    })

    expect(diaryCompletion(index, { [tiers[1].tasks[0].id]: true })).toEqual({
      tiers: 0,
      totalTiers: 2,
      tasks: 1,
      totalTasks: 4,
    })
  })
})

describe('buildDiaryIndex', () => {
  it('resolves a tier id to its diary in one lookup', () => {
    const tiers = [tier('ardougne-easy', 'Easy')]
    const index = buildDiaryIndex([diary(tiers)])
    expect(index.tierById.get('ardougne-easy')?.diary.name).toBe(
      'Ardougne Diary',
    )
    expect(index.byId.get('ardougne')?.tiers).toHaveLength(1)
  })
})

describe('evaluateDiary', () => {
  it('returns one status per tier, in dataset order', () => {
    const tiers = [
      tier('ardougne-easy', 'Easy'),
      tier('ardougne-medium', 'Medium'),
    ]
    const statuses = evaluateDiary(diary(tiers), player(), quests, {})
    expect(statuses.map((s) => s.tier)).toEqual(['Easy', 'Medium'])
  })
})

/**
 * Against the committed dataset rather than fixtures.
 *
 * Fixtures prove the engine's logic; this proves the data the engine will
 * actually be handed still fits it. The failures it exists to catch are a
 * regenerated dataset drifting out of shape — a prerequisite pointing at a
 * quest that no longer exists, or two tasks sharing an id, which would mean
 * ticking one silently ticks the other forever.
 */
describe('the committed dataset', () => {
  it('evaluates end to end, with unique and resolvable ids', async () => {
    const diaries = (await import('../src/data/diaries.json')).default
    const questData = (await import('../src/data/quests.json')).default

    const qi = buildIndex(questData.quests as Quest[])
    const di = buildDiaryIndex(diaries.diaries as unknown as Diary[])

    expect(di.all).toHaveLength(12)
    expect(di.tierById.size).toBe(48)

    const taskIds = new Set<string>()
    let taskCount = 0
    for (const d of di.all) {
      for (const t of d.tiers) {
        for (const prereq of t.requirements.quests) {
          expect(qi.byId.has(prereq.id)).toBe(true)
        }
        for (const task of t.tasks) {
          taskCount++
          taskIds.add(task.id)
          // The id must be reproducible from the text: that is what makes it
          // stable across a regeneration, so a completion survives the wiki
          // renumbering its tasks — see task-id.ts.
          expect(task.id).toBe(taskIdFor(t.id, task.text))
          for (const prereq of task.requirements.quests) {
            expect(qi.byId.has(prereq.id)).toBe(true)
          }
        }
      }
    }
    expect(taskIds.size).toBe(taskCount)

    // A maxed account with every quest done can complete every tier. If this
    // fails, some requirement parsed to something unsatisfiable.
    const maxed: PlayerState = {
      levels: Object.fromEntries(
        SKILL_NAMES.map((s) => [s, 99]),
      ) as PlayerState['levels'],
      progress: Object.fromEntries(
        questData.quests.map((q) => [q.id, 'done' as const]),
      ),
    }
    expect(completableNow(di, maxed, qi, {})).toHaveLength(48)

    const blocked = di.all
      .flatMap((d) => evaluateDiary(d, maxed, qi, {}))
      .reduce((n, s) => n + s.blockedTasks, 0)
    expect(blocked).toBe(0)
  })
})

describe('expandTiers', () => {
  const easy = tier('ardougne-easy', 'Easy')
  const medium = tier('ardougne-medium', 'Medium')
  const di = buildDiaryIndex([diary([easy, medium])])

  it('marks every task in a done tier', () => {
    expect(expandTiers(di, ['ardougne-easy'])).toEqual(allDone(easy))
  })

  it('leaves other tiers alone', () => {
    const out = expandTiers(di, ['ardougne-easy'])
    for (const id of taskIdsOf(medium)) expect(out[id]).toBeUndefined()
  })

  it('ignores ids the dataset does not know', () => {
    expect(expandTiers(di, ['atlantis-easy'])).toEqual({})
  })

  // The point of expanding: a synced tier must read as done through the same
  // derivation the hand-entered record uses, not through a second code path.
  it('reads as a completed tier through tierProgressFrom', () => {
    expect(tierProgressFrom(easy, expandTiers(di, ['ardougne-easy']))).toBe(
      'done',
    )
  })
})

describe('mergeDoneTasks', () => {
  const easy = tier('ardougne-easy', 'Easy')
  const [first, second] = taskIdsOf(easy)

  it('adds synced completions to the player’s own', () => {
    expect(mergeDoneTasks({ [first]: true }, { [second]: true })).toEqual({
      [first]: true,
      [second]: true,
    })
  })

  it('keeps what the player recorded when the snapshot says nothing', () => {
    expect(mergeDoneTasks({ [first]: true }, {})).toEqual({ [first]: true })
  })

  it('does not mutate either input', () => {
    const local = { [first]: true } as const
    const synced = { [second]: true } as const
    mergeDoneTasks(local, synced)
    expect(local).toEqual({ [first]: true })
    expect(synced).toEqual({ [second]: true })
  })

  it('finishes a tier the player had only partly ticked', () => {
    const di = buildDiaryIndex([diary([easy])])
    const merged = mergeDoneTasks(
      { [first]: true },
      expandTiers(di, ['ardougne-easy']),
    )
    expect(tierProgressFrom(easy, { [first]: true })).toBe('doing')
    expect(tierProgressFrom(easy, merged)).toBe('done')
  })
})
