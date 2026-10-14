export type ZoomAnchor = { clientX: number; clientY: number } | 'center' | 'top'

export interface ViewerApi {
  scrollToPage: (index: number, pdfPoint?: [number, number] | null, smooth?: boolean) => void
  zoomTo: (zoom: number, anchor?: ZoomAnchor) => void
  fit: (mode: 'fitWidth' | 'fitPage') => void
  focus: () => void
  element: () => HTMLElement | null
}

const viewers = new Map<string, ViewerApi>()

export function registerViewer(docId: string, api: ViewerApi): () => void {
  viewers.set(docId, api)
  return () => {
    if (viewers.get(docId) === api) viewers.delete(docId)
  }
}

export function getViewer(docId: string | null | undefined): ViewerApi | undefined {
  return docId ? viewers.get(docId) : undefined
}

export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4, 8]
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

export function nextZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 0.001) ?? MAX_ZOOM
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? MIN_ZOOM
}
