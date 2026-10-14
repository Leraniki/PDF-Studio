import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const asset = (p: string): string => new URL(`pdfjs/${p}/`, document.baseURI).href

export class PasswordRequiredError extends Error {
  constructor(public readonly incorrect: boolean) {
    super(incorrect ? 'Неверный пароль' : 'Требуется пароль')
  }
}

export async function loadPdf(data: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  // pdf.js transfers the buffer to its worker, so always give it a copy.
  const task = pdfjs.getDocument({
    data: data.slice(),
    password,
    cMapUrl: asset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts'),
    wasmUrl: asset('wasm'),
    iccUrl: asset('iccs'),
    enableXfa: false
  })
  try {
    return await task.promise
  } catch (e) {
    const err = e as { name?: string; code?: number }
    if (err?.name === 'PasswordException') {
      throw new PasswordRequiredError(err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD)
    }
    throw e
  }
}

export { pdfjs }
