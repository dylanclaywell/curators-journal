/**
 * Rasterizes public/icons/icon.svg into the PNG sizes the manifest and iOS
 * need. iOS ignores SVG for apple-touch-icon, so the home-screen install this
 * app is built around genuinely depends on these files existing.
 *
 * It also copies the source SVG to public/favicon.svg, which browsers prefer
 * over the PNG for the tab icon. That file used to be drawn by hand, and it
 * duly went stale the first time the logo changed — so it is generated now,
 * and icon.svg is the only mark anyone edits.
 *
 * Run after editing the SVG:  npm run build:icons
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = `${root}public/icons/icon.svg`
const svg = await readFile(src)

// Background matches the theme color so the maskable/opaque variants don't
// show a transparent halo behind the rounded corners on iOS.
const BG = '#3E2F1C'

const targets = [
  { out: 'public/pwa-192x192.png', size: 192, pad: 0 },
  { out: 'public/pwa-512x512.png', size: 512, pad: 0 },
  { out: 'public/favicon-96x96.png', size: 96, pad: 0 },
  // apple-touch-icon is composited on an opaque square: iOS applies its own
  // corner mask, so ours must not double up visually.
  { out: 'public/apple-touch-icon.png', size: 180, pad: 0 },
  // Maskable icons get cropped to whatever shape the platform wants, so the
  // artwork is inset into the safe zone (~80% of the canvas).
  { out: 'public/maskable-512x512.png', size: 512, pad: 0.1 },
]

await writeFile(`${root}public/favicon.svg`, svg)
console.log('public/favicon.svg  (copied)')

for (const { out, size, pad } of targets) {
  const inner = Math.round(size * (1 - pad * 2))
  const offset = Math.round((size - inner) / 2)

  const art = await sharp(svg, { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: BG })
    .png()
    .toBuffer()

  const png = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: art, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer()

  await writeFile(`${root}${out}`, png)
  console.log(`${out}  ${size}x${size}`)
}
