/**
 * Downloads OSRS skill icons from the OSRS Wiki into public/skill-icons/.
 *
 * These are **Jagex's copyrighted interface art**, not ours and not freely
 * licensed — see NOTICE.md. They are deliberately NOT committed: the directory
 * is gitignored and repopulated at build time, so the repository carries no
 * Jagex assets.
 *
 * Fetched at build time rather than at runtime because they total ~8 KB and
 * never change. That gets them precached by the service worker (so the app
 * works offline on first launch) and spends none of the wiki's bandwidth on
 * page loads.
 *
 * Fails soft. A wiki outage should not break a build, and stale-but-present
 * icons are better than none. The UI hides a missing icon rather than showing
 * a broken image.
 *
 *   npm run fetch:skill-icons
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = `${root}public/skill-icons`

/** Kept in step with SKILL_NAMES in src/lib/types.ts. */
const SKILLS = [
  'Attack',
  'Defence',
  'Strength',
  'Hitpoints',
  'Ranged',
  'Prayer',
  'Magic',
  'Cooking',
  'Woodcutting',
  'Fletching',
  'Fishing',
  'Firemaking',
  'Crafting',
  'Smithing',
  'Mining',
  'Herblore',
  'Agility',
  'Thieving',
  'Slayer',
  'Farming',
  'Runecraft',
  'Hunter',
  'Construction',
  'Sailing',
]

const API = 'https://oldschool.runescape.wiki/api.php'

/** The wiki asks API consumers to identify themselves. */
const USER_AGENT =
  'CuratorsJournal/0.1 (OSRS quest companion; +https://github.com/dylanclaywell/curators-journal)'

const headers = { 'user-agent': USER_AGENT }

function slug(skill) {
  return skill.toLowerCase()
}

/**
 * Resolves canonical file URLs through the API rather than guessing paths —
 * the wiki appends a cache-busting query and can move files.
 */
async function resolveUrls(skills) {
  const titles = skills.map((s) => `File:${s} icon.png`).join('|')
  const url =
    `${API}?action=query&format=json&prop=imageinfo&iiprop=url|size|mime` +
    `&titles=${encodeURIComponent(titles)}`

  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`wiki API returned ${response.status}`)

  const body = await response.json()
  const pages = Object.values(body?.query?.pages ?? {})

  const found = new Map()
  for (const page of pages) {
    const info = page?.imageinfo?.[0]
    if (!info?.url) continue
    // "File:Attack icon.png" -> "attack"
    const skill = page.title.replace(/^File:/, '').replace(/ icon\.png$/i, '')
    found.set(skill, info)
  }
  return found
}

async function main() {
  await mkdir(outDir, { recursive: true })

  const existing = new Set(
    (await readdir(outDir).catch(() => [])).filter((f) => f.endsWith('.png')),
  )

  let resolved
  try {
    resolved = await resolveUrls(SKILLS)
  } catch (error) {
    console.warn(`\n  skill icons: wiki lookup failed (${error.message})`)
    console.warn(
      `  keeping ${existing.size} already-downloaded icon(s); the UI hides any that are missing.\n`,
    )
    return
  }

  let downloaded = 0
  let bytes = 0
  const missing = []

  for (const skill of SKILLS) {
    const info = resolved.get(skill)
    if (!info) {
      missing.push(skill)
      continue
    }
    try {
      const image = await fetch(info.url, { headers })
      if (!image.ok) throw new Error(`HTTP ${image.status}`)
      const buffer = Buffer.from(await image.arrayBuffer())
      await writeFile(`${outDir}/${slug(skill)}.png`, buffer)
      downloaded++
      bytes += buffer.length
    } catch (error) {
      missing.push(`${skill} (${error.message})`)
    }
  }

  console.log(
    `  skill icons: ${downloaded}/${SKILLS.length} downloaded, ${(bytes / 1024).toFixed(1)} KB total`,
  )
  if (missing.length) {
    console.warn(`  not resolved: ${missing.join(', ')}`)
  }
}

await main()
