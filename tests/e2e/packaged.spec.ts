import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { makeLongPdf } from './fixtures'

const root = join(__dirname, '..', '..')
const exe = join(root, 'dist', 'win-unpacked', 'pdf-studio.exe')

// Runs only after `npm run build:win` produced the unpacked app.
test('packaged app opens a PDF passed on the command line', async () => {
  test.skip(!existsSync(exe), 'packaged app not built')
  const pdf = await makeLongPdf(12, 'short.pdf')
  const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>
  env['PDF_STUDIO_USER_DATA'] = join(root, 'test-results', 'user-data')
  const app = await electron.launch({ executablePath: exe, args: [pdf], env })
  const win = await app.firstWindow()
  await win.waitForSelector('.page canvas', { timeout: 60_000 })
  await expect(win.locator('.page-input span')).toHaveText('/ 12')
  await app.evaluate(({ app }) => app.exit(0))
})
