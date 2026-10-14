// Manual visual check: `npx tsx tests/e2e/screens.ts <outDir>` (not part of the test suite).
import { _electron as electron } from '@playwright/test'
import { join } from 'node:path'
import { makeLongPdf } from './fixtures'

async function main(): Promise<void> {
  const out = process.argv[2] ?? join(__dirname, '..', '..', 'test-results')
  const root = join(__dirname, '..', '..')
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => v !== undefined && k !== 'ELECTRON_RENDERER_URL')
  ) as Record<string, string>
  env['PDF_STUDIO_USER_DATA'] = join(root, 'test-results', 'user-data')

  let app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env })
  let win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.waitForSelector('.home')
  await win.waitForTimeout(500)
  await win.screenshot({ path: join(out, '1-home.png') })
  await app.evaluate(({ app }) => app.exit(0))

  const pdf = await makeLongPdf(40)
  app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js'), pdf], cwd: root, env })
  win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.waitForSelector('.page canvas')
  await win.waitForTimeout(1200)
  await win.screenshot({ path: join(out, '2-viewer.png') })

  // Highlight some text by selecting it with the highlight tool.
  await win.keyboard.press('e')
  const span = win.locator('.textLayer span').nth(3)
  const b = (await span.boundingBox())!
  await win.mouse.move(b.x + 2, b.y + b.height / 2)
  await win.mouse.down()
  await win.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps: 5 })
  await win.mouse.up()
  // Draw an arrow and a free text box.
  await win.keyboard.press('a')
  const vb = (await win.locator('[data-testid="viewer"]').boundingBox())!
  await win.mouse.move(vb.x + vb.width / 2 + 100, vb.y + 460)
  await win.mouse.down()
  await win.mouse.move(vb.x + vb.width / 2 + 250, vb.y + 380, { steps: 5 })
  await win.mouse.up()
  await win.keyboard.press('t')
  await win.mouse.click(vb.x + vb.width / 2 + 60, vb.y + 520)
  await win.keyboard.type('Комментарий к тексту')
  await win.mouse.click(vb.x + 30, vb.y + 30)
  await win.keyboard.press('s')
  await win.mouse.click(vb.x + vb.width / 2 + 180, vb.y + 620)
  await win.waitForTimeout(600)
  await win.screenshot({ path: join(out, '3-annotations.png') })

  await win.keyboard.press('Control+f')
  await win.keyboard.type('fox')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(1500)
  await win.screenshot({ path: join(out, '4-search.png') })
  await win.keyboard.press('Escape')

  await win.locator('.segmented button', { hasText: 'Страницы' }).click()
  await win.waitForTimeout(1500)
  await win.screenshot({ path: join(out, '5-organize.png') })

  await app.evaluate(({ app }) => app.exit(0))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
