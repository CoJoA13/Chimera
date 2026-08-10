import { useState } from 'react'
import { MessagesSquare, Loader2, X } from 'lucide-react'
import { useChat } from '../../stores/chat'
import { MarkdownBlock } from './MarkdownBlock'

/** "What would another model have said?" — replay the last question elsewhere. */
export function SecondOpinionButton() {
  const active = useChat((s) => s.conversations.find((c) => c.id === s.activeConvId))
  const models = useChat((s) => s.models)
  const hasTurns = useChat(
    (s) => (s.activeConvId ? (s.blocksByConv[s.activeConvId] ?? []) : []).some((b) => b.kind === 'user')
  )
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState<{ model: string; text: string } | null>(null)

  if (!active || active.kind === 'group' || !hasTurns) return null

  const run = async (provider: 'claude' | 'codex', model: string, name: string): Promise<void> => {
    setRunning(name)
    setResult(null)
    try {
      const text = await window.chimera.secondOpinion(active.id, provider, model)
      setResult({ model: name, text })
    } catch (err) {
      setResult({ model: name, text: `Failed: ${err instanceof Error ? err.message : err}` })
    } finally {
      setRunning(null)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Second opinion — replay the last question with a different model"
        className="flex items-center rounded-md border border-[#30363d] bg-[#161b22] p-1.5 text-slate-400 hover:bg-[#21262d]"
      >
        <MessagesSquare size={13} />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="flex max-h-[80vh] w-[640px] max-w-[94vw] flex-col rounded-xl border border-[#30363d] bg-[#10151c] p-4 shadow-2xl">
            <div className="mb-3 flex items-center gap-2">
              <MessagesSquare size={16} className="text-cyan-400" />
              <span className="font-medium text-slate-100">Second opinion on the last question</span>
              <button
                onClick={() => setOpen(false)}
                className="ml-auto text-slate-500 hover:text-slate-200"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {models
                .filter((m) => !(m.provider === active.provider && m.id === active.model))
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={() => void run(m.provider, m.id, m.name)}
                    disabled={running !== null}
                    className="rounded-md border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-xs text-slate-300 hover:border-cyan-700 hover:text-cyan-300 disabled:opacity-40"
                  >
                    {running === m.name ? (
                      <Loader2 size={12} className="inline animate-spin" />
                    ) : (
                      m.name
                    )}
                  </button>
                ))}
            </div>
            {result && (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                <p className="mb-2 text-xs font-medium text-cyan-300">{result.model} says:</p>
                <MarkdownBlock text={result.text} />
              </div>
            )}
            {!result && !running && (
              <p className="text-sm text-slate-600">
                Pick a model — it gets the recent conversation as context and answers the same
                question independently (no tools, read-only).
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
