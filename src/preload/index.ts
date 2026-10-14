import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface OpenedFile {
  path: string
  name: string
  data: Uint8Array
}

export interface RecentEntry {
  path: string
  name: string
  openedAt: number
}

export interface PrinterEntry {
  name: string
  displayName: string
}

export interface PrintJobOptions {
  /** false shows the system print dialog. */
  silent: boolean
  deviceName?: string
  copies: number
  collate: boolean
  duplexMode: 'simplex' | 'longEdge' | 'shortEdge'
  color: boolean
  landscape: boolean
  paper: 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal'
}

export interface PrintResult {
  ok: boolean
  error?: string
}

const api = {
  openDialog: (opts?: { multi?: boolean; title?: string }): Promise<OpenedFile[]> =>
    ipcRenderer.invoke('dialog:open', opts),
  saveDialog: (opts?: { defaultPath?: string; title?: string }): Promise<string | null> =>
    ipcRenderer.invoke('dialog:save', opts),
  directoryDialog: (opts?: { title?: string }): Promise<string | null> =>
    ipcRenderer.invoke('dialog:directory', opts),
  readFile: (path: string): Promise<OpenedFile> => ipcRenderer.invoke('file:read', path),
  writeFile: (path: string, data: Uint8Array): Promise<boolean> =>
    ipcRenderer.invoke('file:write', path, data),
  joinPath: (dir: string, name: string): Promise<string> => ipcRenderer.invoke('path:join', dir, name),
  getRecent: (): Promise<RecentEntry[]> => ipcRenderer.invoke('recent:get'),
  addRecent: (path: string): Promise<RecentEntry[]> => ipcRenderer.invoke('recent:add', path),
  removeRecent: (path: string): Promise<RecentEntry[]> => ipcRenderer.invoke('recent:remove', path),
  getSettings: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('settings:get'),
  setSettings: (value: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('settings:set', value),
  getUsername: (): Promise<string> => ipcRenderer.invoke('system:username'),
  getSystemFont: (): Promise<Uint8Array | null> => ipcRenderer.invoke('system:font'),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (path: string): Promise<void> => ipcRenderer.invoke('shell:showItem', path),
  getPrinters: (): Promise<PrinterEntry[]> => ipcRenderer.invoke('print:printers'),
  /** Print job: begin, add sheet images (JPEG bytes), run one or more passes, end. */
  printBegin: (): Promise<string> => ipcRenderer.invoke('print:begin'),
  printAddSheet: (job: string, data: Uint8Array): Promise<string> => ipcRenderer.invoke('print:add-sheet', job, data),
  printRun: (job: string, sheets: string[], options: PrintJobOptions): Promise<PrintResult> =>
    ipcRenderer.invoke('print:run', job, sheets, options),
  printEnd: (job: string): Promise<void> => ipcRenderer.invoke('print:end', job),
  getPendingPaths: (): Promise<string[]> => ipcRenderer.invoke('app:pending-paths'),
  confirmClose: (): Promise<void> => ipcRenderer.invoke('app:confirm-close'),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  onOpenPaths: (cb: (paths: string[]) => void): (() => void) => {
    const listener = (_e: unknown, paths: string[]): void => cb(paths)
    ipcRenderer.on('app:open-paths', listener)
    return () => ipcRenderer.removeListener('app:open-paths', listener)
  },
  onCloseRequest: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:close-request', listener)
    return () => ipcRenderer.removeListener('app:close-request', listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
