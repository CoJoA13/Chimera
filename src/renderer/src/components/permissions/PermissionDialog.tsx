import { ShieldQuestion } from 'lucide-react'
import { useChat } from '../../stores/chat'

export function PermissionDialog() {
  const permissions = useChat((s) => s.permissions)
  const respond = useChat((s) => s.respondPermission)
  const current = permissions[0]
  if (!current) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[480px] max-w-[90vw] rounded-xl border border-[#30363d] bg-[#161b22] p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2 text-slate-100">
          <ShieldQuestion size={18} className="text-amber-400" />
          <span className="font-medium">Permission request</span>
          {permissions.length > 1 && (
            <span className="ml-auto text-xs text-slate-500">+{permissions.length - 1} queued</span>
          )}
        </div>
        <p className="mb-2 text-sm text-slate-300">
          The agent wants to use <span className="font-mono text-amber-200">{current.toolName}</span>
        </p>
        <pre className="mb-4 max-h-56 overflow-auto rounded bg-[#0d1117] p-3 font-mono text-xs text-slate-300">
          {JSON.stringify(current.input, null, 2)}
        </pre>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => void respond(current.requestId, 'deny')}
            className="rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-slate-300 hover:bg-[#21262d]"
          >
            Deny
          </button>
          <button
            onClick={() => void respond(current.requestId, 'allow', true)}
            className="rounded-md border border-emerald-800 bg-emerald-900/40 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-900/70"
          >
            Always allow {current.toolName}
          </button>
          <button
            onClick={() => void respond(current.requestId, 'allow')}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
