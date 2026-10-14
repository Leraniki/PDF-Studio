import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { existsSync, promises as fs, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, join, normalize, resolve, sep } from 'node:path'
import { userInfo } from 'node:os'
import { pathToFileURL } from 'node:url'
import icon from '../../resources/icon.png?asset'
import type { PrintJobOptions, PrintResult } from '../preload'

const BG = '#0e0e10'
const isDev = !!process.env['ELECTRON_RENDERER_URL']
const rendererRoot = join(__dirname, '../renderer')
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' data: blob:"
].join('; ')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
])

// Lets automated tests run with an isolated profile (recent files, settings).
if (process.env['PDF_STUDIO_USER_DATA']) app.setPath('userData', process.env['PDF_STUDIO_USER_DATA'])

let mainWindow: BrowserWindow | null = null
const PAPERS: PrintJobOptions['paper'][] = ['A4', 'A3', 'A5', 'Letter', 'Legal']
const printJobs = new Map<string, { dir: string; count: number }>()
let allowClose = false
const pendingPaths: string[] = []

function pdfPathsFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((a) => /\.pdf$/i.test(a) && existsSync(a))
}

function sendOpenPaths(paths: string[]): void {
  if (!paths.length) return
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('app:open-paths', paths)
  } else {
    pendingPaths.push(...paths)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: BG,
    title: 'PDF Studio',
    icon,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#b9b9c0', height: 40 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  mainWindow.setMenu(null)

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    mainWindow?.webContents.send('app:close-request')
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Never navigate the app window away; open external links in the browser.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') mainWindow?.webContents.toggleDevTools()
  })

  if (isDev) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  } else {
    mainWindow.loadURL('app://bundle/index.html')
  }
}

// ---------- persistent JSON helpers ----------

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(join(app.getPath('userData'), name), 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(name: string, value: unknown): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(join(app.getPath('userData'), name), JSON.stringify(value, null, 2), 'utf8')
}

interface RecentEntry {
  path: string
  name: string
  openedAt: number
}

async function getRecent(): Promise<RecentEntry[]> {
  const list = await readJson<RecentEntry[]>('recent.json', [])
  return list.filter((r) => existsSync(r.path))
}

async function addRecent(path: string): Promise<RecentEntry[]> {
  const list = (await getRecent()).filter((r) => r.path.toLowerCase() !== path.toLowerCase())
  list.unshift({ path, name: basename(path), openedAt: Date.now() })
  const trimmed = list.slice(0, 20)
  await writeJson('recent.json', trimmed)
  app.addRecentDocument(path)
  return trimmed
}

async function readPdf(path: string): Promise<{ path: string; name: string; data: Uint8Array }> {
  const data = await fs.readFile(path)
  return { path, name: basename(path), data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
}

// ---------- IPC ----------

function registerIpc(): void {
  ipcMain.handle('dialog:open', async (_e, opts: { multi?: boolean; title?: string } = {}) => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: opts.title ?? 'Открыть PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile']
    })
    if (res.canceled) return []
    return Promise.all(res.filePaths.map(readPdf))
  })

  ipcMain.handle('dialog:save', async (_e, opts: { defaultPath?: string; title?: string } = {}) => {
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: opts.title ?? 'Сохранить PDF',
      defaultPath: opts.defaultPath,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    return res.canceled || !res.filePath ? null : res.filePath
  })

  ipcMain.handle('dialog:directory', async (_e, opts: { title?: string } = {}) => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: opts.title ?? 'Выберите папку',
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('file:read', (_e, path: string) => readPdf(path))

  ipcMain.handle('file:write', async (_e, path: string, data: Uint8Array) => {
    // Write to a temp file first so a failed write never corrupts the original.
    const tmp = `${path}.${process.pid}.tmp`
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, path)
    return true
  })

  ipcMain.handle('path:join', (_e, dir: string, name: string) => join(dir, name))

  ipcMain.handle('recent:get', () => getRecent())
  ipcMain.handle('recent:add', (_e, path: string) => addRecent(path))
  ipcMain.handle('recent:remove', async (_e, path: string) => {
    const list = (await getRecent()).filter((r) => r.path !== path)
    await writeJson('recent.json', list)
    return list
  })

  ipcMain.handle('settings:get', () => readJson('settings.json', {}))
  ipcMain.handle('settings:set', (_e, value: unknown) => writeJson('settings.json', value))

  ipcMain.handle('system:username', () => {
    try {
      return userInfo().username
    } catch {
      return 'User'
    }
  })

  ipcMain.handle('system:font', async () => {
    // A TrueType font with Cyrillic coverage for annotation appearance streams.
    const fontsDir = join(process.env['WINDIR'] ?? 'C:\\Windows', 'Fonts')
    for (const f of ['arial.ttf', 'segoeui.ttf', 'tahoma.ttf', 'verdana.ttf']) {
      try {
        const buf = await fs.readFile(join(fontsDir, f))
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      } catch {
        /* try next */
      }
    }
    return null
  })

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (!/^(https?:|mailto:)/i.test(url)) return false
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle('shell:showItem', (_e, path: string) => shell.showItemInFolder(path))

  ipcMain.handle('app:pending-paths', () => pendingPaths.splice(0))

  ipcMain.handle('app:confirm-close', () => {
    allowClose = true
    mainWindow?.close()
  })

  ipcMain.handle('print:printers', async () => {
    const list = (await mainWindow?.webContents.getPrintersAsync()) ?? []
    return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name }))
  })

  // Print jobs: the renderer streams sheet images (JPEG) into a temp folder one by one,
  // then prints them through a hidden window. Keeps memory flat for large documents.
  ipcMain.handle('print:begin', async () => {
    const id = randomUUID()
    printJobs.set(id, { dir: await fs.mkdtemp(join(app.getPath('temp'), 'pdf-studio-print-')), count: 0 })
    return id
  })

  ipcMain.handle('print:add-sheet', async (_e, id: string, data: Uint8Array) => {
    const job = printJobs.get(id)
    if (!job) throw new Error('Задание печати не найдено')
    const name = `${job.count++}.jpg`
    await fs.writeFile(join(job.dir, name), data)
    return name
  })

  ipcMain.handle('print:run', async (_e, id: string, names: string[], o: PrintJobOptions): Promise<PrintResult> => {
    const job = printJobs.get(id)
    if (!job) return { ok: false, error: 'Задание печати не найдено' }
    if (!names.every((n) => /^\d+\.jpg$/.test(n))) return { ok: false, error: 'Неверный лист' }
    const paper = PAPERS.includes(o.paper) ? o.paper : 'A4'
    const body = names.map((n) => `<div class="p"><img src="${n}"></div>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: ${paper} ${o.landscape ? 'landscape' : 'portrait'}; margin: 0 }
      html, body { margin: 0; padding: 0; background: #fff }
      .p { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; page-break-after: always; break-after: page; overflow: hidden }
      .p:last-child { page-break-after: auto; break-after: auto }
      img { width: 100%; height: 100%; object-fit: contain }
    </style></head><body>${body}</body></html>`
    const file = join(job.dir, `job-${job.count++}.html`)
    await fs.writeFile(file, html, 'utf8')
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await win.loadFile(file)
    } catch (e) {
      win.destroy()
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    return new Promise<PrintResult>((resolvePrint) => {
      try {
        win.webContents.print(
          {
            silent: o.silent,
            deviceName: o.deviceName,
            copies: Math.min(999, Math.max(1, Math.floor(o.copies) || 1)),
            collate: o.collate,
            duplexMode: o.duplexMode,
            color: o.color,
            landscape: o.landscape,
            pageSize: paper,
            printBackground: true,
            margins: { marginType: 'none' }
          },
          (ok, reason) => {
            win.destroy()
            resolvePrint(ok ? { ok } : { ok, error: reason || 'failed' })
          }
        )
      } catch (e) {
        win.destroy()
        resolvePrint({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })
  })

  ipcMain.handle('print:end', async (_e, id: string) => {
    const job = printJobs.get(id)
    printJobs.delete(id)
    if (job) await fs.rm(job.dir, { recursive: true, force: true }).catch(() => undefined)
  })
}

// ---------- app lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    sendOpenPaths(pdfPathsFromArgv(argv))
  })

  pendingPaths.push(...pdfPathsFromArgv(process.argv))

  app.whenReady().then(() => {
    protocol.handle('app', async (req) => {
      const url = new URL(req.url)
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const file = normalize(resolve(rendererRoot, rel))
      if (!file.startsWith(normalize(rendererRoot) + sep)) {
        return new Response('Not found', { status: 404 })
      }
      const res = await net.fetch(pathToFileURL(file).toString())
      if (!file.endsWith('.html')) return res
      const headers = new Headers(res.headers)
      headers.set('Content-Type', 'text/html; charset=utf-8')
      headers.set('Content-Security-Policy', CSP)
      return new Response(res.body, { status: res.status, headers })
    })

    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('will-quit', () => {
    for (const job of printJobs.values()) {
      try {
        rmSync(job.dir, { recursive: true, force: true })
      } catch {
        /* still locked by the spooler */
      }
    }
    printJobs.clear()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
