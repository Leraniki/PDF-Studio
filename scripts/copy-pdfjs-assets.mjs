// Copies pdf.js runtime assets (CMaps, standard fonts, wasm decoders, ICC profiles)
// into the renderer public folder so they are served in dev and bundled in production.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'pdfjs-dist')
const dest = join(root, 'src', 'renderer', 'public', 'pdfjs')

for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const from = join(src, dir)
  if (!existsSync(from)) continue
  mkdirSync(join(dest, dir), { recursive: true })
  cpSync(from, join(dest, dir), { recursive: true })
}
console.log('pdf.js assets copied to', dest)
