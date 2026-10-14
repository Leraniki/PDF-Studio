import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { makeLongPdf } from './fixtures'

const root = join(__dirname, '..', '..')
let app: ElectronApplication
let win: Page
let pdfPath: string

const VIEWER = '[data-testid="viewer"]'

async function pageTops(): Promise<Record<string, number>> {
  return win.$$eval('.page', (els) =>
    Object.fromEntries(els.map((e) => [(e as HTMLElement).dataset.pageId!, parseFloat((e as HTMLElement).style.top)]))
  )
}

test.beforeAll(async () => {
  const pdf = await makeLongPdf()
  pdfPath = pdf
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => v !== undefined && k !== 'ELECTRON_RENDERER_URL')
  ) as Record<string, string>
  env['PDF_STUDIO_USER_DATA'] = join(root, 'test-results', 'user-data')
  app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js'), pdf], cwd: root, env })
  win = await app.firstWindow()
  await win.waitForSelector('.page canvas', { timeout: 60_000 })
})

test.afterAll(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
})

test('layout is fixed before rendering: canvases never move pages', async () => {
  const before = await pageTops()
  const height = await win.$eval(`${VIEWER} .viewer-content`, (e) => (e as HTMLElement).style.height)
  await win.waitForTimeout(1500)
  const after = await pageTops()
  for (const id of Object.keys(before)) if (id in after) expect(after[id]).toBe(before[id])
  expect(await win.$eval(`${VIEWER} .viewer-content`, (e) => (e as HTMLElement).style.height)).toBe(height)
})

test('mouse wheel scrolls by exactly the wheel delta and never jumps to another page', async () => {
  const box = (await win.locator(VIEWER).boundingBox())!
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

  // Record every scroll position the viewer goes through.
  await win.$eval(VIEWER, (el) => {
    const w = window as unknown as { __samples: number[] }
    w.__samples = []
    el.addEventListener('scroll', () => w.__samples.push(el.scrollTop))
  })

  for (let i = 0; i < 12; i++) {
    const start = await win.$eval(VIEWER, (el) => el.scrollTop)
    await win.mouse.wheel(0, 240)
    await win.waitForFunction(
      ([sel, target]) => Math.abs(document.querySelector(sel as string)!.scrollTop - (target as number)) < 2,
      [VIEWER, start + 240] as const,
      { timeout: 5000 }
    )
    const end = await win.$eval(VIEWER, (el) => el.scrollTop)
    expect(Math.abs(end - start - 240)).toBeLessThan(2)
  }

  const samples = await win.evaluate(() => (window as unknown as { __samples: number[] }).__samples)
  expect(samples.length).toBeGreaterThan(0)
  for (let i = 1; i < samples.length; i++) {
    // Monotonic, and no single step larger than one wheel notch.
    expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 0.5)
    expect(samples[i] - samples[i - 1]).toBeLessThanOrEqual(241)
  }
})

test('far scroll: pages keep their position while they render', async () => {
  await win.$eval(VIEWER, (el) => (el.scrollTop = el.scrollHeight * 0.6))
  await win.waitForTimeout(50)
  const scrollBefore = await win.$eval(VIEWER, (el) => el.scrollTop)
  const before = await pageTops()
  await win.waitForTimeout(1500)
  const after = await pageTops()
  for (const id of Object.keys(before)) if (id in after) expect(after[id]).toBe(before[id])
  expect(await win.$eval(VIEWER, (el) => el.scrollTop)).toBe(scrollBefore)
})

test('Ctrl + wheel zoom keeps the point under the cursor in place', async () => {
  const box = (await win.locator(VIEWER).boundingBox())!
  const cx = box.x + box.width * 0.4
  const cy = box.y + box.height * 0.45
  await win.mouse.move(cx, cy)

  const probe = (): Promise<{ id: string; fx: number; fy: number } | null> =>
    win.evaluate(
      ([x, y]) => {
        const el = document.elementsFromPoint(x, y).find((e) => e.classList.contains('page')) as HTMLElement | undefined
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { id: el.dataset.pageId!, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height }
      },
      [cx, cy] as const
    )

  const before = await probe()
  expect(before).not.toBeNull()
  const zoomBefore = await win.locator('.zoom-select > button').innerText()

  await win.keyboard.down('Control')
  await win.mouse.wheel(0, -200)
  await win.keyboard.up('Control')
  await win.waitForTimeout(400)

  expect(await win.locator('.zoom-select > button').innerText()).not.toBe(zoomBefore)
  const pos = await win.evaluate((id) => {
    const el = document.querySelector(`.page[data-page-id="${id}"]`) as HTMLElement
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  }, before!.id)
  expect(Math.abs(pos.left + before!.fx * pos.width - cx)).toBeLessThan(2)
  expect(Math.abs(pos.top + before!.fy * pos.height - cy)).toBeLessThan(2)
})

test('draw a rectangle annotation, then undo it', async () => {
  await win.locator(VIEWER).click({ position: { x: 5, y: 5 } })
  const count = (): Promise<number> => win.locator('.annot-layer .annot-hit').count()
  const initial = await count()
  await win.keyboard.press('r')
  const page = win.locator('.page').filter({ has: win.locator('canvas') }).first()
  const pb = (await page.boundingBox())!
  const vb = (await win.locator(VIEWER).boundingBox())!
  const x0 = Math.max(pb.x, vb.x) + 60
  const y0 = Math.max(pb.y, vb.y) + 60
  await win.mouse.move(x0, y0)
  await win.mouse.down()
  await win.mouse.move(x0 + 120, y0 + 80, { steps: 6 })
  await win.mouse.up()
  await expect.poll(count).toBe(initial + 1)
  await win.keyboard.press('Control+z')
  await expect.poll(count).toBe(initial)
})

test('free text survives deselection and is saved into the PDF', async () => {
  const vb = (await win.locator(VIEWER).boundingBox())!
  const page = win.locator('.page').filter({ has: win.locator('canvas') }).first()
  const pb = (await page.boundingBox())!
  const x = Math.max(pb.x, vb.x) + 80
  const y = Math.max(pb.y, vb.y) + 200
  await win.keyboard.press('t')
  await win.mouse.click(x, y)
  await win.locator('.freetext-box textarea').waitFor()
  await win.keyboard.type('Hello PDF')
  // Clicking the empty area around pages ends editing via deselection.
  await win.mouse.click(vb.x + 8, vb.y + vb.height / 2)
  await expect(win.locator('.freetext-box', { hasText: 'Hello PDF' })).toHaveCount(1)

  await win.keyboard.press('Control+s')
  await expect(win.locator('.toast', { hasText: 'Сохранено' })).toBeVisible({ timeout: 20_000 })

  const bytes = readFileSync(pdfPath)
  const doc = await PDFDocument.load(bytes)
  const found = doc.getPages().some((p) => {
    const annots = p.node.Annots()
    if (!annots) return false
    return annots.asArray().some((ref) => {
      const d = doc.context.lookup(ref, PDFDict)
      return d.lookup(PDFName.of('Subtype'))?.toString() === '/FreeText' && d.lookup(PDFName.of('Contents'))?.toString().length
    })
  })
  expect(found).toBe(true)
  expect(doc.getPageCount()).toBe(320)
})
