import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Wrench } from 'lucide-react'

function pretty(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function DiffLines({ text, sign }: { text: string; sign: '-' | '+' }) {
  const cls =
    sign === '-'
      ? 'bg-red-950/40 text-red-300 border-red-900/40'
      : 'bg-emerald-950/40 text-emerald-300 border-emerald-900/40'
  return (
    <pre className={`overflow-x-auto rounded border px-2 py-1 font-mono text-xs whitespace-pre-wrap ${cls}`}>
      {text
        .split('\n')
        .map((line) => `${sign} ${line}`)
        .join('\n')}
    </pre>
  )
}

/** Red/green rendering for file-editing tools; null for everything else. */
function DiffView({ toolName, input }: { toolName: string; input: unknown }) {
  const args = (input ?? {}) as Record<string, unknown>
  const filePath = typeof args.file_path === 'string' ? args.file_path : null
  const edits: { old_string?: string; new_string?: string }[] =
    toolName === 'Edit' && typeof args.old_string === 'string'
      ? [args as { old_string: string; new_string: string }]
      : toolName === 'MultiEdit' && Array.isArray(args.edits)
        ? (args.edits as { old_string?: string; new_string?: string }[])
        : []

  if (toolName === 'Write' && typeof args.content === 'string') {
    return (
      <div className="space-y-1">
        {filePath && <div className="font-mono text-xs text-slate-400">{filePath}</div>}
        <DiffLines text={args.content.slice(0, 4000)} sign="+" />
      </div>
    )
  }
  if (edits.length === 0) return null
  return (
    <div className="space-y-1.5">
      {filePath && <div className="font-mono text-xs text-slate-400">{filePath}</div>}
      {edits.map((edit, i) => (
        <div key={i} className="space-y-0.5">
          {edit.old_string && <DiffLines text={edit.old_string} sign="-" />}
          {edit.new_string && <DiffLines text={edit.new_string} sign="+" />}
        </div>
      ))}
    </div>
  )
}

export function ToolCallCard({
  toolName,
  input,
  output,
  isError,
  done,
  defaultOpen = false
}: {
  toolName: string
  input: unknown
  output?: unknown
  isError?: boolean
  done: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])

  return (
    <div className="my-2 rounded-lg border border-[#30363d] bg-[#161b22]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-300 hover:bg-[#1c2129]"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Wrench size={14} className="text-slate-500" />
        <span className="font-mono text-[13px]">{toolName}</span>
        <span className="ml-auto">
          {!done ? (
            <Loader2 size={14} className="animate-spin text-sky-400" />
          ) : isError ? (
            <XCircle size={14} className="text-red-400" />
          ) : (
            <CheckCircle2 size={14} className="text-emerald-400" />
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-[#30363d] px-3 py-2 text-xs">
          <div className="mb-1 font-medium text-slate-500">Input</div>
          {DiffView({ toolName, input }) ?? (
            <pre className="max-h-48 overflow-auto rounded bg-[#0d1117] p-2 font-mono text-slate-300">
              {pretty(input)}
            </pre>
          )}
          {done && (
            <>
              <div className="mt-2 mb-1 font-medium text-slate-500">Output</div>
              <pre className="max-h-48 overflow-auto rounded bg-[#0d1117] p-2 font-mono text-slate-300">
                {pretty(output ?? '(no output)')}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
