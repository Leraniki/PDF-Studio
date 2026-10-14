import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { makeLongPdf } from './fixtures'

const root = join(__dirname, '..', '..')
let app: ElectronApplication
let win: Page

interface Call {
  sheets: number
  files: number
  options: Record<string, unknown>
}

test.beforeAll(async () => {
  const pdf = await makeLongPdf(9, 'print.pdf')
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => v !== undefined && k !== 'ELECTRON_RENDERER_URL')
  ) as Record<string, string>
  env['PDF_STUDIO_USER_DATA'] = join(root, 'test-results', 'user-data-print')
  rmSync(env['PDF_STUDIO_USER_DATA'], { recursive: true, force: true })
  app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js'), pdf], cwd: root, env })
  win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.waitForSelector('.page canvas')
  // Replace the printer with a recorder; sheet files are still written by the real handlers.
  await app.evaluate(({ app, ipcMain }) => {
    const g = globalThis as unknown as { printCalls: Call[] }
    g.printCalls = []
    ipcMain.removeHandler('print:run')
    ipcMain.handle('print:run', (_e, _id: string, sheets: string[], options: Record<string, unknown>) => {
      const fs = process.mainModule!.require('node:fs') as typeof import('node:fs')
      const files = fs.readdirSync(app.getPath('temp')).filter((n) => n.startsWith('pdf-studio-print-'))
      g.printCalls.push({ sheets: sheets.length, files: files.length, options })
      return { ok: true }
    })
  })
})

test.afterAll(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
})

const calls = (): Promise<Call[]> =>
  app.evaluate(() => {
    const g = globalThis as unknown as { printCalls: Call[] }
    return g.printCalls.splice(0)
  })

test('print dialog shows a preview and sheet count', async () => {
  await win.keyboard.press('Control+p')
  const modal = win.locator('.modal')
  await expect(modal.locator('h2')).toHaveText('Печать')
  await expect(win.locator('.print-preview canvas')).toBeVisible()
  await expect(modal.locator('.print-nav')).toContainText('Лист 1 из 9')
  await win.screenshot({ path: join(root, 'test-results', 'print-1.png') })

  await modal.getByRole('button', { name: 'Диапазон' }).click()
  await modal.locator('input[placeholder^="например"]').fill('1-20')
  await expect(modal.locator('.field-error')).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Печать', exact: true })).toBeDisabled()
  await modal.locator('input[placeholder^="например"]').fill('2-7')
  await modal.locator('select').nth(1).selectOption('odd')
  await expect(modal.locator('.print-nav')).toContainText('Лист 1 из 3')

  await modal.locator('select').nth(3).selectOption('4')
  await expect(modal.locator('.print-nav')).toContainText('Лист 1 из 1')
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(root, 'test-results', 'print-2.png') })
  await modal.locator('select').nth(3).selectOption('1')

  await modal.locator('select').nth(2).selectOption('longEdge')
  await modal.getByRole('button', { name: 'Печать', exact: true }).click()
  await expect.poll(async () => (await app.evaluate(() => (globalThis as unknown as { printCalls: Call[] }).printCalls.length))).toBe(1)
  const [call] = await calls()
  expect(call.sheets).toBe(3)
  expect(call.files).toBeGreaterThan(0)
  expect(call.options).toMatchObject({ silent: true, duplexMode: 'longEdge', copies: 1, paper: 'A4' })
})

test('manual duplex prints fronts, asks to flip, then backs', async () => {
  await win.keyboard.press('Control+p')
  const modal = win.locator('.modal')
  // Duplex choice is remembered; page range is not.
  await expect(modal.locator('select').nth(2)).toHaveValue('longEdge')
  await expect(modal.locator('.print-nav')).toContainText('Лист 1 из 9')
  await modal.locator('select').nth(2).selectOption('manual')
  await expect(modal.locator('.print-note')).toBeVisible()
  await win.screenshot({ path: join(root, 'test-results', 'print-3.png') })
  await modal.getByRole('button', { name: 'Печать', exact: true }).click()
  await expect(win.locator('.modal h2')).toHaveText('Печать второй стороны')
  const first = await calls()
  expect(first.map((c) => c.sheets)).toEqual([5])
  await win.getByRole('button', { name: 'Печатать вторую сторону' }).click()
  await expect.poll(async () => (await app.evaluate(() => (globalThis as unknown as { printCalls: Call[] }).printCalls.length))).toBe(1)
  const [second] = await calls()
  expect(second.sheets).toBe(5)
  expect(second.options).toMatchObject({ duplexMode: 'simplex' })
})

test('comments can be left out of the printout', async () => {
  // Draw a red rectangle on page 1.
  await win.keyboard.press('r')
  const page = (await win.locator('.page').first().boundingBox())!
  await win.mouse.move(page.x + page.width * 0.3, page.y + page.height * 0.3)
  await win.mouse.down()
  await win.mouse.move(page.x + page.width * 0.7, page.y + page.height * 0.5, { steps: 5 })
  await win.mouse.up()
  await win.keyboard.press('v')

  const redPixels = (): Promise<number> =>
    win.evaluate(() => {
      const c = document.querySelector('.print-preview canvas') as HTMLCanvasElement
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 120 && d[i + 2] < 120) n++
      return n
    })

  await win.keyboard.press('Control+p')
  const modal = win.locator('.modal')
  await expect(modal.locator('.print-preview-busy')).toHaveCount(0)
  expect(await redPixels()).toBeGreaterThan(50)
  await modal.getByText('Печатать комментарии и пометки').click()
  await expect(modal.locator('.print-preview-busy')).toHaveCount(0)
  await expect.poll(redPixels).toBe(0)

  // Custom scale accepts typing a two-digit value.
  await modal.locator('select').nth(7).selectOption('custom')
  const scale = modal.locator('input[type="number"]').nth(1)
  await scale.fill('')
  await scale.pressSequentially('50')
  await expect(scale).toHaveValue('50')
  await modal.getByRole('button', { name: 'Отмена' }).click()
})

test('Ctrl+P does not replace the flip prompt', async () => {
  await win.keyboard.press('Control+p')
  const modal = win.locator('.modal')
  await expect(modal.locator('select').nth(2)).toHaveValue('manual')
  await modal.getByRole('button', { name: 'Печать', exact: true }).click()
  await expect(win.locator('.modal h2')).toHaveText('Печать второй стороны')
  await win.keyboard.press('Control+p')
  await expect(win.locator('.modal h2')).toHaveText('Печать второй стороны')
  await win.getByRole('button', { name: 'Отмена' }).click()
  await expect(win.locator('.modal')).toHaveCount(0)
  await calls()
  // The job folder is removed once the job ends.
  await expect
    .poll(() =>
      app.evaluate(({ app }) => {
        const fs = process.mainModule!.require('node:fs') as typeof import('node:fs')
        return fs.readdirSync(app.getPath('temp')).filter((n) => n.startsWith('pdf-studio-print-')).length
      })
    )
    .toBe(0)
})
