import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { readFileSync, rmSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { makeLongPdf } from './fixtures'

const root = join(__dirname, '..', '..')
const outDir = join(root, 'test-results', 'print-output')
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  const pdf = await makeLongPdf(9, 'print-output.pdf')
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => v !== undefined && k !== 'ELECTRON_RENDERER_URL')
  ) as Record<string, string>
  env['PDF_STUDIO_USER_DATA'] = join(root, 'test-results', 'user-data-print-output')
  rmSync(env['PDF_STUDIO_USER_DATA'], { recursive: true, force: true })
  rmSync(outDir, { recursive: true, force: true })
  app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js'), pdf], cwd: root, env })
  win = await app.firstWindow()
  await win.waitForSelector('.page canvas')
  // Keep the real print pipeline but make the "printer" write a PDF with the same page setup.
  await app.evaluate(({ app }, dir) => {
    const fs = process.mainModule!.require('node:fs') as typeof import('node:fs')
    const path = process.mainModule!.require('node:path') as typeof import('node:path')
    fs.mkdirSync(dir, { recursive: true })
    let n = 0
    app.on('web-contents-created', (_e, wc) => {
      wc.print = ((opts: Electron.WebContentsPrintOptions, cb: (ok: boolean, reason: string) => void) => {
        wc.printToPDF({ landscape: opts.landscape, pageSize: opts.pageSize as 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 }, printBackground: true }).then(
          (buf) => {
            fs.writeFileSync(path.join(dir, `${n++}.pdf`), buf)
            cb(true, '')
          },
          (e: Error) => cb(false, e.message)
        )
      }) as typeof wc.print
    })
  }, outDir)
})

test.afterAll(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
})

/** Paper sizes differ by a point or two between mm and pt rounding. */
const near = (a: [number, number], b: [number, number]): boolean => Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2

async function sizes(file: string): Promise<[number, number][]> {
  const doc = await PDFDocument.load(readFileSync(join(outDir, file)))
  return doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])
}

test('one sheet per printed page, in the chosen paper size', async () => {
  await win.keyboard.press('Control+p')
  const modal = win.locator('.modal')
  await modal.locator('select').nth(3).selectOption('2') // 2 per sheet → landscape A4
  await expect(modal.locator('.print-nav')).toContainText('Лист 1 из 5')
  await modal.getByRole('button', { name: 'Печать', exact: true }).click()
  await expect(win.locator('.toast')).toContainText('отправлен на печать')
  const pages = await sizes('0.pdf')
  expect(pages).toHaveLength(5)
  for (const [w, h] of pages) expect(near([w, h], [842, 595])).toBe(true)

  await win.keyboard.press('Control+p')
  await modal.locator('select').nth(3).selectOption('1')
  await modal.locator('select').nth(5).selectOption('A5')
  await modal.getByRole('button', { name: 'Печать', exact: true }).click()
  await expect.poll(() => sizes('1.pdf').catch(() => [])).toHaveLength(9)
  for (const [w, h] of await sizes('1.pdf')) expect(near([w, h], [420, 595])).toBe(true)
})
