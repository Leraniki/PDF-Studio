// Manual visual check for stage 2: `npx tsx tests/e2e/screens2.ts <outDir>`.
import { _electron as electron } from '@playwright/test'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { makeLongPdf, FIXTURE_DIR } from './fixtures'

async function main(): Promise<void> {
  const out = process.argv[2] ?? join(__dirname, '..', '..', 'test-results')
  const root = join(__dirname, '..', '..')
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => v !== undefined && k !== 'ELECTRON_RENDERER_URL')
  ) as Record<string, string>
  env['PDF_STUDIO_USER_DATA'] = join(root, 'test-results', 'user-data-screens')

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  page.drawText('Application form', { x: 60, y: 770, size: 24, font })
  const labels = ['Full name', 'E-mail', 'City']
  const form = doc.getForm()
  labels.forEach((l, i) => {
    page.drawText(l, { x: 60, y: 706 - i * 50, size: 12, font })
    form.createTextField(`f${i}`).addToPage(page, { x: 160, y: 698 - i * 50, width: 300, height: 24, font })
  })
  page.drawText('I agree with the terms', { x: 88, y: 552, size: 12, font })
  form.createCheckBox('agree').addToPage(page, { x: 60, y: 548, width: 18, height: 18 })
  const formPath = join(FIXTURE_DIR, 'screens-form.pdf')
  writeFileSync(formPath, await doc.save())
  const longPath = await makeLongPdf(20, 'screens-long.pdf')

  const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js'), formPath], cwd: root, env })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.waitForSelector('.page canvas')
  await win.locator('input.form-field').first().fill('Анна Смирнова')
  await win.waitForTimeout(800)
  await win.screenshot({ path: join(out, 's2-1-form.png') })

  await win.locator('.toolrail button[title="Подписать"]').click()
  await win.locator('.sig-menu .menu-item').click()
  await win.locator('.segmented button', { hasText: 'Ввести' }).click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(out, 's2-2-signature.png') })
  await win.locator('.modal .btn.primary', { hasText: 'Готово' }).click()
  const pb = (await win.locator('.page').first().boundingBox())!
  await win.mouse.click(pb.x + pb.width * 0.62, pb.y + pb.height * 0.5)
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(out, 's2-3-signed.png') })

  await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('app:open-paths', [p]), longPath)
  await win.waitForTimeout(1500)
  await win.locator('button[title="Инструменты документа"]').click()
  await win.waitForTimeout(200)
  await win.screenshot({ path: join(out, 's2-4-tools-menu.png') })
  await win.locator('.menu-item', { hasText: 'Водяной знак' }).click()
  await win.waitForTimeout(300)
  await win.screenshot({ path: join(out, 's2-5-watermark.png') })
  await win.locator('.modal .btn.primary', { hasText: 'Применить' }).click()
  await win.locator('button[title="Инструменты документа"]').click()
  await win.locator('.menu-item', { hasText: 'Колонтитулы' }).click()
  await win.waitForTimeout(300)
  await win.screenshot({ path: join(out, 's2-6-headerfooter.png') })
  await win.locator('.modal .btn.primary', { hasText: 'Применить' }).click()
  await win.waitForTimeout(600)
  await win.screenshot({ path: join(out, 's2-7-decorated.png') })
  await win.locator('button[title="Инструменты документа"]').click()
  await win.locator('.menu-item', { hasText: 'Защитить паролем' }).click()
  await win.locator('.modal label', { hasText: 'Требовать пароль' }).click()
  await win.locator('.modal label', { hasText: 'Ограничить' }).click()
  await win.waitForTimeout(300)
  await win.screenshot({ path: join(out, 's2-8-protect.png') })
  await app.evaluate(({ app }) => app.exit(0))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
