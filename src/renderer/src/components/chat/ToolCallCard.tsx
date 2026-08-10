import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Wrench } from 'lucide-react'

function pretty(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function ToolCallCard({
  toolName,
  input,
  output,
  isError,
  done
}: {
  toolName: string
  input: unknown
  output?: unknown
  isError?: boolean
  done: boolean
}) {
  const [open, setOpen] = useState(false)

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
          <pre className="max-h-48 overflow-auto rounded bg-[#0d1117] p-2 font-mono text-slate-300">
            {pretty(input)}
          </pre>
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
