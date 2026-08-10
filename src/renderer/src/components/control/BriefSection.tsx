import { useEffect, useState } from 'react'
import { Sunrise, Check } from 'lucide-react'
import { MarkdownBlock } from '../chat/MarkdownBlock'

interface Brief {
  summary: string | null
  items: { ts: number; kind: string; text: string }[]
}

/** "While you were away": digest of schedules, watchers, bus traffic, reports. */
export function BriefSection() {
  const [brief, setBrief] = useState<Brief | null>(null)

  useEffect(() => {
    void window.chimera.getBrief().then(setBrief)
  }, [])

  if (!brief || brief.items.length === 0) return null

  const dismiss = async (): Promise<void> => {
    await window.chimera.markBriefRead()
    setBrief(null)
  }

  return (
    <section className="rounded-xl border border-cyan-900/50 bg-cyan-950/10 p-4">
      <div className="mb-2 flex items-center gap-2 text-slate-100">
        <Sunrise size={15} className="text-cyan-300" />
        <span className="font-medium">While you were away</span>
        <span className="text-xs text-slate-500">{brief.items.length} events</span>
        <button
          onClick={() => void dismiss()}
          className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-slate-200"
        >
          <Check size={13} /> Mark read
        </button>
      </div>
      {brief.summary ? (
        <div className="text-sm">
          <MarkdownBlock text={brief.summary} />
        </div>
      ) : (
        <div className="space-y-1">
          {brief.items.slice(0, 8).map((item, i) => (
            <p key={i} className="text-xs text-slate-400">
              <span className="text-slate-600">{new Date(item.ts).toLocaleTimeString()}</span>{' '}
              <span className="text-cyan-400">[{item.kind}]</span> {item.text}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
