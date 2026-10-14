/** Parses "1-3, 5, 8-10" into 0-based page index groups; returns null on bad input. */
export function parseRanges(input: string, pageCount: number): number[][] | null {
  const groups: number[][] = []
  for (const part of input.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*(?:[-–]\s*(\d+))?$/.exec(part)
    if (!m) return null
    const a = parseInt(m[1], 10)
    const b = m[2] ? parseInt(m[2], 10) : a
    if (a < 1 || b < 1 || a > pageCount || b > pageCount) return null
    const step = a <= b ? 1 : -1
    const g: number[] = []
    for (let i = a; step > 0 ? i <= b : i >= b; i += step) g.push(i - 1)
    groups.push(g)
  }
  return groups.length ? groups : null
}

/** Whether a 0-based page index is covered by a range string ('' or invalid = all pages). */
export function inRanges(input: string, index: number, pageCount: number): boolean {
  if (!input.trim()) return true
  const groups = parseRanges(input, pageCount)
  return !groups || groups.some((g) => g.includes(index))
}
