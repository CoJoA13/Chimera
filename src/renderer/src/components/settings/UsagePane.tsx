import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'

interface Summary {
  today: { reportedCost: number; estimatedCost: number; total: number }
  budgetUsd: number | null
  byConversation: {
    conversationId: string
    title: string
    reportedCost: number
    estimatedCost: number
    total: number
  }[]
}

export function UsagePane() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [budgetInput, setBudgetInput] = useState('')

  const refresh = async (): Promise<void> => {
    const s = await window.chimera.usageSummary()
    setSummary(s)
    setBudgetInput(s.budgetUsd?.toString() ?? '')
  }

  useEffect(() => {
    void refresh()
  }, [])

  const saveBudget = async (): Promise<void> => {
    const value = budgetInput.trim() === '' ? null : Number(budgetInput)
    if (value !== null && (Number.isNaN(value) || value <= 0)) return
    await window.chimera.setDailyBudget(value)
    await refresh()
  }

  if (!summary) return null
  const overBudget = summary.budgetUsd !== null && summary.today.total >= summary.budgetUsd

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-4">
        <div className="flex items-center gap-2">
          <Wallet size={16} className={overBudget ? 'text-red-400' : 'text-emerald-400'} />
          <span className="text-2xl font-semibold text-slate-100">
            ${summary.today.total.toFixed(2)}
          </span>
          <span className="text-sm text-slate-500">tracked usage today</span>
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-slate-400">Daily budget:</span>
          <span className="text-slate-500">$</span>
          <input
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            placeholder="none"
            className="w-20 rounded border border-[#30363d] bg-[#161b22] px-2 py-1"
          />
          <button
            onClick={() => void saveBudget()}
            className="rounded-md border border-[#30363d] px-2.5 py-1 text-xs text-slate-300 hover:bg-[#21262d]"
          >
            Save
          </button>
          {overBudget && (
            <span className="text-xs text-red-400">Budget threshold reached — new sends are blocked.</span>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-600">
          Reported or legacy usage: ${summary.today.reportedCost.toFixed(2)}. New admission estimates: $
          {summary.today.estimatedCost.toFixed(2)}. The budget is a soft guard: admitted turns reserve
          an estimate and may settle slightly above the threshold. Clear the field to remove it.
        </p>
        <button
          onClick={() =>
            void window.chimera.exportBackup().then((dest) => {
              if (dest) window.alert(`Backup written to ${dest}`)
            })
          }
          className="mt-3 rounded-md border border-[#30363d] px-3 py-1.5 text-xs text-slate-300 hover:bg-[#21262d]"
        >
          Export backup (database, memories, skills, artifacts)…
        </button>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-300">Last 7 days by conversation</p>
        {summary.byConversation.length === 0 && (
          <p className="text-sm text-slate-500">No tracked usage recorded yet.</p>
        )}
        {summary.byConversation.map((row) => (
          <div
            key={row.conversationId}
            className="flex items-center gap-2 border-b border-[#161b22] py-1.5 text-sm"
          >
            <span className="min-w-0 flex-1 truncate text-slate-300">{row.title}</span>
            <span className="font-mono text-slate-400" title={`Reported/legacy $${row.reportedCost.toFixed(3)}; estimated $${row.estimatedCost.toFixed(3)}`}>
              {row.estimatedCost > 0 && row.reportedCost === 0 ? '~' : ''}${row.total.toFixed(3)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
