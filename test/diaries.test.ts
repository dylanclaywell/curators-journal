/**
 * The diary engine's job is to be honest about three distinctions the data
 * makes and a naive reading would flatten:
 *
 *   - a tier's own requirements versus the requirements of the tasks in it,
 *     which the wiki maintains separately and which genuinely disagree;
 *   - completing a tier versus claiming its rewards, where only the second is
 *     gated on the tiers below;
 *   - a level we know is too low versus a level we have no snapshot for.
 *
 * Each of those has a failure mode that is invisible in the UI — a tier shown
 * as blocked when it is workable, or ready when it is not — so they are what
 * these tests are for. The shared requirement checking is `quests.ts`'s and is
 * not re-tested here.
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
} from '../src/lib/diaries'
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

const task = (over: Partial<DiaryTask> = {}): DiaryTask => ({
  text: 'do the thing',
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
  tasks: [],
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
    const t = tier('ardougne-medium', 'Medium', {
      tasks: [
        task(),
        task({
          requirements: {
            skills: [
              {
                skill: 'Agility',
                level: 90,
                boostable: null,
                requiredToStart: null,
              },
            ],
            quests: [],
          },
        }),
      ],
    })
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
    const status = evaluateDiaryTier(diary(tiers), tiers[2], player(), quests, {
      'ardougne-easy': 'done',
    })
    expect(status.rewardsBlockedBy).toEqual(['Medium'])
  })

  it('reports nothing blocking once every tier below is done', () => {
    const status = evaluateDiaryTier(diary(tiers), tiers[3], player(), quests, {
      'ardougne-easy': 'done',
      'ardougne-medium': 'done',
      'ardougne-hard': 'done',
    })
    expect(status.rewardsBlockedBy).toEqual([])
  })

  it('does not count an in-progress tier as done for reward claiming', () => {
    const status = evaluateDiaryTier(diary(tiers), tiers[1], player(), quests, {
      'ardougne-easy': 'doing',
    })
    expect(status.rewardsBlockedBy).toEqual(['Easy'])
  })
})

describe('completableNow', () => {
  it('omits tiers already done and tiers still blocked', () => {
    const tiers = [
      tier('ardougne-easy', 'Easy'),
      tier('ardougne-medium', 'Medium', {
        requirements: {
          skills: [
            {
              skill: 'Agility',
              level: 90,
              boostable: null,
              requiredToStart: null,
            },
          ],
          quests: [],
        },
      }),
      tier('ardougne-hard', 'Hard'),
      tier('ardougne-elite', 'Elite'),
    ]
    const index = buildDiaryIndex([diary(tiers)])
    const ready = completableNow(index, player(), quests, {
      'ardougne-hard': 'done',
    })

    expect(ready.map((t) => t.id)).toEqual(['ardougne-easy', 'ardougne-elite'])
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

describe('diaryCompletion', () => {
  it('counts done tiers across every diary', () => {
    const index = buildDiaryIndex([
      diary([tier('ardougne-easy', 'Easy'), tier('ardougne-medium', 'Medium')]),
    ])
    expect(diaryCompletion(index, { 'ardougne-easy': 'done' })).toEqual({
      done: 1,
      total: 2,
    })
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
 * actually be handed still fits it. The failure it exists to catch is a
 * regenerated dataset drifting out of the shape — a tier id colliding, a
 * prerequisite pointing at a quest that no longer exists — which typechecks
 * perfectly and only shows up as a quietly wrong answer in the UI.
 */
describe('the committed dataset', () => {
  it('evaluates end to end, and every id is unique and resolvable', async () => {
    const diaries = (await import('../src/data/diaries.json')).default
    const questData = (await import('../src/data/quests.json')).default

    const qi = buildIndex(questData.quests as Quest[])
    const di = buildDiaryIndex(diaries.diaries as unknown as Diary[])

    expect(di.all).toHaveLength(12)
    expect(di.tierById.size).toBe(48)

    for (const d of di.all) {
      for (const t of d.tiers) {
        for (const prereq of t.requirements.quests) {
          expect(qi.byId.has(prereq.id)).toBe(true)
        }
        for (const task of t.tasks) {
          for (const prereq of task.requirements.quests) {
            expect(qi.byId.has(prereq.id)).toBe(true)
          }
        }
      }
    }

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
    const ready = completableNow(di, maxed, qi, {})
    expect(ready).toHaveLength(48)

    const blocked = di.all
      .flatMap((d) => evaluateDiary(d, maxed, qi, {}))
      .reduce((n, s) => n + s.blockedTasks, 0)
    expect(blocked).toBe(0)
  })
})
