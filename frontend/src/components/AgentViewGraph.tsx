import { useState } from 'react'
import type { AgentViewData, NodeType } from '../data/mock'

const typeStyles: Record<NodeType, { fill: string; stroke: string; label: string; chip: string }> = {
  disease: { fill: '#fecdd3', stroke: '#e11d48', label: 'Disease', chip: 'bg-rose-100 text-rose-700' },
  treatment: { fill: '#c7d2fe', stroke: '#4f46e5', label: 'Treatment / Tool', chip: 'bg-indigo-100 text-indigo-700' },
  biomarker: { fill: '#fde68a', stroke: '#d97706', label: 'Biomarker', chip: 'bg-amber-100 text-amber-700' },
  outcome: { fill: '#a7f3d0', stroke: '#059669', label: 'Outcome', chip: 'bg-emerald-100 text-emerald-700' },
  population: { fill: '#bae6fd', stroke: '#0284c7', label: 'Population', chip: 'bg-sky-100 text-sky-700' },
  risk: { fill: '#fed7aa', stroke: '#ea580c', label: 'Risk / Limitation', chip: 'bg-orange-100 text-orange-700' },
}

const effectColor = {
  positive: '#059669',
  negative: '#e11d48',
  neutral: '#94a3b8',
}

const W = 1000
const H = 620

export function AgentViewGraph({ data }: { data: AgentViewData }) {
  const [selected, setSelected] = useState<string | null>(null)

  const px = (x: number) => 70 + (x / 100) * (W - 140)
  const py = (y: number) => 60 + (y / 100) * (H - 120)
  const radius = (weight: number) => 26 + weight * 4.5

  const node = (id: string) => data.nodes.find((n) => n.id === id)!
  const selectedNode = selected ? node(selected) : null

  const dimmed = (id: string) =>
    selected !== null &&
    selected !== id &&
    !data.links.some(
      (l) => (l.from === selected && l.to === id) || (l.to === selected && l.from === id),
    )

  return (
    <div>
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
        <div className="mb-1 flex items-center gap-2 text-xs font-bold tracking-wide text-indigo-600 uppercase">
          ✦ Agent synthesis
          <span className="ml-auto rounded-full bg-white px-2.5 py-0.5 font-semibold text-indigo-700 normal-case">
            confidence {data.confidence}%
          </span>
        </div>
        <p className="text-[15px] leading-relaxed text-slate-800">{data.summary}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {Object.entries(typeStyles).map(([key, style]) => (
          <span
            key={key}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style.chip}`}
          >
            {style.label}
          </span>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Concept map of the article">
          <defs>
            <marker id="arrow-positive" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={effectColor.positive} />
            </marker>
            <marker id="arrow-negative" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={effectColor.negative} />
            </marker>
            <marker id="arrow-neutral" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={effectColor.neutral} />
            </marker>
          </defs>

          {data.links.map((link, i) => {
            const a = node(link.from)
            const b = node(link.to)
            const x1 = px(a.x)
            const y1 = py(a.y)
            const x2 = px(b.x)
            const y2 = py(b.y)
            const dx = x2 - x1
            const dy = y2 - y1
            const dist = Math.hypot(dx, dy)
            const rA = radius(a.weight)
            const rB = radius(b.weight) + 8
            const sx = x1 + (dx / dist) * rA
            const sy = y1 + (dy / dist) * rA
            const ex = x2 - (dx / dist) * rB
            const ey = y2 - (dy / dist) * rB
            const mx = (sx + ex) / 2
            const my = (sy + ey) / 2
            const faded =
              selected !== null && link.from !== selected && link.to !== selected
            return (
              <g key={i} opacity={faded ? 0.15 : 1} style={{ transition: 'opacity 0.2s' }}>
                <line
                  x1={sx}
                  y1={sy}
                  x2={ex}
                  y2={ey}
                  stroke={effectColor[link.effect]}
                  strokeWidth={link.strength * 1.6}
                  strokeDasharray={link.effect === 'negative' ? '7 5' : undefined}
                  markerEnd={`url(#arrow-${link.effect})`}
                  opacity={0.75}
                />
                <text
                  x={mx}
                  y={my - 7}
                  textAnchor="middle"
                  fontSize="15"
                  fontWeight="600"
                  fill="#475569"
                  stroke="#ffffff"
                  strokeWidth="4"
                  paintOrder="stroke"
                >
                  {link.label}
                </text>
              </g>
            )
          })}

          {data.nodes.map((n) => {
            const style = typeStyles[n.type]
            const r = radius(n.weight)
            const cx = px(n.x)
            const cy = py(n.y)
            const words = n.label.split(' ')
            const lines: string[] =
              n.label.length > 14 && words.length > 1
                ? [
                    words.slice(0, Math.ceil(words.length / 2)).join(' '),
                    words.slice(Math.ceil(words.length / 2)).join(' '),
                  ]
                : [n.label]
            return (
              <g
                key={n.id}
                opacity={dimmed(n.id) ? 0.2 : 1}
                style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                onClick={() => setSelected(selected === n.id ? null : n.id)}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth={selected === n.id ? 5 : 2.5}
                />
                {lines.map((line, li) => (
                  <text
                    key={li}
                    x={cx}
                    y={cy + (li - (lines.length - 1) / 2) * 18 + 5}
                    textAnchor="middle"
                    fontSize="16"
                    fontWeight="700"
                    fill="#1e293b"
                  >
                    {line}
                  </text>
                ))}
              </g>
            )
          })}
        </svg>
      </div>

      <div className="mt-3 min-h-16 rounded-2xl border border-slate-200 bg-white p-4">
        {selectedNode ? (
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 rounded-full px-2.5 py-1 text-xs font-semibold ${typeStyles[selectedNode.type].chip}`}
            >
              {typeStyles[selectedNode.type].label}
            </span>
            <div>
              <div className="font-bold text-slate-900">{selectedNode.label}</div>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{selectedNode.detail}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            💡 Click a bubble to see what the agent extracted about that concept. Bubble size =
            importance in the article; dashed red lines = negative effects or limitations.
          </p>
        )}
      </div>
    </div>
  )
}
