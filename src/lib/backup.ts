/**
 * Export/import for the user-owned half of the app's state.
 *
 * Pure on purpose, like `quests.ts`: building and validating the backup shape
 * has nothing to do with the DOM (file pickers, downloads) or IndexedDB, so it
 * stays testable and stays out of the way of `src/worker/`'s separate
 * tsconfig even though nothing here currently runs there.
 *
 * Scope is deliberately narrow — only what's hand-entered and unrecoverable:
 * `settings` (username, account type) and quest `progress`/`goals`. Cached
 * hiscores are excluded; they refetch themselves from a username, which is
 * exactly why they aren't in this category. See ROADMAP.md slice 4b′.
 */
import type { AccountType } from './types'
import type { QuestProgress } from './quests'

/**
 * The app slug written into the file. It changed when StageScape was renamed
 * to Curator's Journal, so `LEGACY_APPS` keeps older exports importable: a
 * backup is the only recovery path for data that has no other source, and
 * refusing to read one because the app was renamed would defeat its purpose.
 */
const APP = 'curators-journal'
const LEGACY_APPS: ReadonlySet<string> = new Set(['stagescape'])

export interface Backup {
  version: 1
  app: typeof APP
  /** ISO timestamp, informational — shown to the player, not checked on import. */
  exportedAt: string
  settings: {
    username: string
    accountType: AccountType
  }
  quests: {
    progress: Record<string, QuestProgress>
    goals: string[]
  }
}

export interface BackupInput {
  username: string
  accountType: AccountType
  progress: Record<string, QuestProgress>
  goals: string[]
}

export function createBackup(input: BackupInput): Backup {
  return {
    version: 1,
    app: APP,
    exportedAt: new Date().toISOString(),
    settings: {
      username: input.username,
      accountType: input.accountType,
    },
    quests: {
      progress: { ...input.progress },
      goals: [...input.goals],
    },
  }
}

export type ParseResult =
  { ok: true; backup: Backup } | { ok: false; error: string }

const ACCOUNT_TYPES: ReadonlySet<string> = new Set([
  'normal',
  'ironman',
  'hardcore',
  'ultimate',
  'deadman',
  'seasonal',
  'tournament',
  'skiller',
  'skiller_defence',
])

const PROGRESS_STATES: ReadonlySet<string> = new Set(['todo', 'doing', 'done'])

/**
 * Validates rather than trusts. This is the one path where arbitrary text
 * found on disk — hand-edited, or from a future version — gets written into
 * IndexedDB, so a malformed file must fail loudly with a reason rather than
 * silently corrupting stored progress.
 */
export function parseBackup(raw: unknown): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error })

  if (typeof raw !== 'object' || raw === null) {
    return fail("Not a Curator's Journal backup file.")
  }
  const obj = raw as Record<string, unknown>

  if (obj.app !== APP && !LEGACY_APPS.has(obj.app as string)) {
    return fail("Not a Curator's Journal backup file.")
  }
  if (obj.version !== 1) {
    return fail(`Unsupported backup version: ${JSON.stringify(obj.version)}.`)
  }

  const settings = obj.settings as Record<string, unknown> | undefined
  if (
    !settings ||
    typeof settings.username !== 'string' ||
    typeof settings.accountType !== 'string' ||
    !ACCOUNT_TYPES.has(settings.accountType)
  ) {
    return fail('Backup file is missing or has invalid settings.')
  }

  const quests = obj.quests as Record<string, unknown> | undefined
  if (
    !quests ||
    typeof quests.progress !== 'object' ||
    quests.progress === null ||
    !Array.isArray(quests.goals)
  ) {
    return fail('Backup file is missing or has invalid quest data.')
  }

  const progress = quests.progress as Record<string, unknown>
  for (const [id, state] of Object.entries(progress)) {
    if (typeof state !== 'string' || !PROGRESS_STATES.has(state)) {
      return fail(`Backup file has an invalid progress entry for "${id}".`)
    }
  }
  if (!quests.goals.every((goal) => typeof goal === 'string')) {
    return fail('Backup file has an invalid goal list.')
  }

  return {
    ok: true,
    backup: {
      version: 1,
      app: APP,
      exportedAt:
        typeof obj.exportedAt === 'string'
          ? obj.exportedAt
          : new Date().toISOString(),
      settings: {
        username: settings.username,
        accountType: settings.accountType as AccountType,
      },
      quests: {
        progress: progress as Record<string, QuestProgress>,
        goals: quests.goals as string[],
      },
    },
  }
}
