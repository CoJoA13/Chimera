import { useEffect, useState } from 'react'
import { KeyRound, Trash2 } from 'lucide-react'
import type { PermissionRuleSummary } from '../../../../shared/ipc'

function describeInput(pattern: string | null): string {
  if (!pattern) return 'Any input (legacy rule)'
  try {
    const value = JSON.parse(pattern) as Record<string, unknown>
    const primary = value.command ?? value.path ?? value.file_path ?? value.url
    if (typeof primary === 'string') return primary
    return JSON.stringify(value, null, 2)
  } catch {
    return pattern
  }
}

export function PermissionsPane() {
  const [rules, setRules] = useState<PermissionRuleSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      setRules(await window.chimera.listPermissionRules())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const revoke = async (id: string): Promise<void> => {
    try {
      await window.chimera.removePermissionRule(id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        “Always allow” grants are exact matches for one tool invocation. Revoking a grant makes the
        agent ask again the next time it requests that action.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {rules.length === 0 && (
        <p className="text-sm text-slate-500">No saved permission grants.</p>
      )}
      <div className="space-y-1.5">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="flex items-start gap-3 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          >
            <KeyRound size={14} className="mt-0.5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm text-slate-200">
                <span className="font-medium">{rule.toolName}</span>
                <span className="truncate text-xs text-slate-500">{rule.conversationTitle}</span>
              </div>
              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-slate-500">
                {describeInput(rule.inputPattern)}
              </pre>
            </div>
            <button
              onClick={() => void revoke(rule.id)}
              className="text-slate-600 hover:text-red-400"
              title="Revoke grant"
              aria-label={`Revoke ${rule.toolName} grant`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
