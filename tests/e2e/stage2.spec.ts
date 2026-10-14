import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { FIXTURE_DIR } from './fixtures'

const root = join(__dirname, '..', '..')
let app: ElectronApplication
let win: Page
let formPath: string

async function makeFormPdf(): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  page.drawText('Application form', { x: 60, y: 780, size: 22, font })
  page.drawText('Name:', { x: 60, y: 716, size: 12, font })
  page.drawText('I agree', { x: 90, y: 668, size: 12, font })
  const form = doc.getForm()
  form.createTextField('name').addToPage(page, { x: 120, y: 708, width: 260, height: 24, font })
  form.createCheckBox('agree').addToPage(page, { x: 60, y: 664, width: 18, height: 18 })
  mkdirSync(FIXTURE_DIR, { recursive: true })
  const path = join(FIXTURE_DIR, 'form.pdf')
  writeFileSync(path, await doc.save())
  return path
}

async function openPath(path: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('app:open-paths', [p]), path)
}

test.beforeAll(async () => {
  formPath = await makeFormPdf()
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && k !== 'ELECTRON_RENDERER_URL')) as Record<string, string>
  env['PDF_STUDIO_USER_DATA'] = join(root, 'test-results', 'user-data')
  app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js'), formPath], cwd: root, env })
  win = await app.firstWindow()
  await win.waitForSelector('.page canvas', { timeout: 60_000 })
})

test.afterAll(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
})

test('form fields are editable and saved into the AcroForm', async () => {
  await expect(win.locator('.info-bar', { hasText: 'поля формы' })).toBeVisible()
  const input = win.locator('input.form-field').first()
  await input.click()
  await input.fill('Анна Смирнова')
  await win.locator('.form-toggle').first().click()
  await expect(win.locator('.form-toggle.on')).toHaveCount(1)

  await win.keyboard.press('Control+s')
  await expect(win.locator('.toast', { hasText: 'Сохранено' })).toBeVisible({ timeout: 20_000 })
  const form = (await PDFDocument.load(readFileSync(formPath))).getForm()
  expect(form.getTextField('name').getText()).toBe('Анна Смирнова')
  expect(form.getCheckBox('agree').isChecked()).toBe(true)
})

test('draw a signature and place it on the page', async () => {
  await win.locator('.toolrail button[title="Подписать"]').click()
  await win.locator('.sig-menu .menu-item', { hasText: 'Создать подпись' }).click()
  const pad = win.locator('.sig-pad canvas')
  const b = (await pad.boundingBox())!
  await win.mouse.move(b.x + 60, b.y + 120)
  await win.mouse.down()
  for (let i = 1; i <= 12; i++) await win.mouse.move(b.x + 60 + i * 25, b.y + 120 - Math.sin(i) * 40)
  await win.mouse.up()
  await win.locator('.modal .btn.primary', { hasText: 'Готово' }).click()
  await expect(win.locator('.info-bar', { hasText: 'разместить подпись' })).toBeVisible()

  const page = win.locator('.page').first()
  const pb = (await page.boundingBox())!
  await win.mouse.click(pb.x + pb.width * 0.6, pb.y + pb.height * 0.3)
  await expect(win.locator('.image-box')).toHaveCount(1)
  await expect(win.locator('.rightpanel .panel-title', { hasText: 'Подпись' })).toBeVisible()
  // The signature is remembered for next time.
  await win.locator('.toolrail button[title="Подписать"]').click()
  await expect(win.locator('.sig-menu .sig-item')).toHaveCount(1)
  await win.keyboard.press('Escape')
  await win.mouse.click(pb.x + 5, pb.y - 5)
})

test('watermark and page numbers are previewed on the pages', async () => {
  await win.locator('button[title="Инструменты документа"]').click()
  await win.locator('.menu-item', { hasText: 'Водяной знак' }).click()
  await win.locator('.modal input').first().fill('ЧЕРНОВИК')
  await win.locator('.modal .btn.primary', { hasText: 'Применить' }).click()
  await expect(win.locator('.decor-layer text', { hasText: 'ЧЕРНОВИК' })).toHaveCount(1)

  await win.locator('button[title="Инструменты документа"]').click()
  await win.locator('.menu-item', { hasText: 'Колонтитулы' }).click()
  await win.locator('.modal .btn', { hasText: 'Страница N из M' }).click()
  await win.locator('.modal .btn.primary', { hasText: 'Применить' }).click()
  await expect(win.locator('.decor-layer text', { hasText: 'Страница 1 из 1' })).toHaveCount(1)

  // Undo removes the page numbers again.
  await win.locator('[data-testid="viewer"]').click({ position: { x: 5, y: 5 } })
  await win.keyboard.press('Control+z')
  await expect(win.locator('.decor-layer text', { hasText: 'Страница 1 из 1' })).toHaveCount(0)
})

test('password protection is applied on save and asked on open', async () => {
  await win.locator('button[title="Инструменты документа"]').click()
  await win.locator('.menu-item', { hasText: 'Защитить паролем' }).click()
  await win.locator('.modal label', { hasText: 'Требовать пароль' }).click()
  const pw = win.locator('.modal input[type="password"]')
  await pw.nth(0).fill('секрет')
  await pw.nth(1).fill('секрет')
  await win.locator('.modal .btn.primary', { hasText: 'Применить' }).click()
  // A toast from an earlier save would satisfy the wait below before this save finishes.
  await expect(win.locator('.toast', { hasText: 'Сохранено' })).toHaveCount(0, { timeout: 10_000 })
  await win.keyboard.press('Control+s')
  await expect(win.locator('.toast', { hasText: 'Сохранено' }).last()).toBeVisible({ timeout: 20_000 })

  const saved = new Uint8Array(readFileSync(formPath))
  await expect(PDFDocument.load(saved)).rejects.toThrow()

  // Reopen the file from scratch: close the tab first, then open it again.
  await win.keyboard.press('Control+w')
  await expect(win.locator('.home')).toBeVisible()
  await openPath(formPath)
  await expect(win.locator('.modal h2', { hasText: 'защищён паролем' })).toBeVisible()
  await win.locator('.modal input[type="password"]').fill('неверно')
  await win.keyboard.press('Enter')
  await expect(win.locator('.modal', { hasText: 'Неверный пароль' })).toBeVisible()
  await win.locator('.modal input[type="password"]').fill('секрет')
  await win.keyboard.press('Enter')
  await win.waitForSelector('.page canvas', { timeout: 30_000 })
  // Saved content survived: form value, signature and watermark.
  await expect(win.locator('input.form-field').first()).toHaveValue('Анна Смирнова')
  await expect(win.locator('.image-box')).toHaveCount(1)
  await expect(win.locator('.info-bar', { hasText: 'поля формы' })).toBeVisible()
})
