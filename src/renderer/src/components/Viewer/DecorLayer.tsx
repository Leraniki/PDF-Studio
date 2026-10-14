import { memo, useMemo } from 'react'
import { useDocStore } from '../../store/docStore'
import { decorItems, hasDecor } from '../../lib/decor'

/** Live preview of the watermark and headers / footers that are burned in on save. */
export const DecorLayer = memo(function DecorLayer({
  docId,
  index,
  width,
  height,
  scale
}: {
  docId: string
  index: number
  width: number
  height: number
  scale: number
}) {
  const decor = useDocStore((s) => s.docs[docId]?.decor)
  const count = useDocStore((s) => s.docs[docId]?.pages.length ?? 0)
  const name = useDocStore((s) => s.docs[docId]?.name ?? '')
  const w = width / scale
  const h = height / scale
  const items = useMemo(
    () => (decor && hasDecor(decor) ? decorItems(decor, w, h, { pageIndex: index, pageCount: count, fileName: name, date: new Date() }) : []),
    [decor, w, h, index, count, name]
  )
  if (!items.length) return null
  return (
    <svg className="decor-layer" width={width} height={height} viewBox={`0 0 ${w} ${h}`}>
      {items.map((it, i) =>
        it.kind === 'text' ? (
          <text
            key={i}
            x={it.x}
            y={it.y}
            fontSize={it.size}
            fontFamily="Arial, 'Segoe UI', sans-serif"
            fill={it.color}
            opacity={it.opacity}
            textAnchor={it.anchor}
            dominantBaseline={it.middle ? 'central' : 'alphabetic'}
            transform={it.angle ? `rotate(${-it.angle} ${it.x} ${it.y})` : undefined}
            style={{ whiteSpace: 'pre' }}
          >
            {it.text}
          </text>
        ) : (
          <image
            key={i}
            href={it.src}
            x={it.cx - it.w / 2}
            y={it.cy - it.h / 2}
            width={it.w}
            height={it.h}
            opacity={it.opacity}
            preserveAspectRatio="none"
            transform={it.angle ? `rotate(${-it.angle} ${it.cx} ${it.cy})` : undefined}
          />
        )
      )}
    </svg>
  )
})
