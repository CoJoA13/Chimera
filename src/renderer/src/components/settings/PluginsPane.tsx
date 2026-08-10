import { useEffect, useState } from 'react'
import { Puzzle, Trash2, FolderPlus } from 'lucide-react'

interface PluginRow {
  id: string
  name: string
  path: string
  enabled: boolean
}

export function PluginsPane() {
  const [plugins, setPlugins] = useState<PluginRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    setPlugins(await window.chimera.listPlugins())
  }

  useEffect(() => {
    void refresh()
  }, [])

  const add = async (): Promise<void> => {
    setError(null)
    try {
      const added = await window.chimera.addPlugin()
      if (added) await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Claude Code plugins (skills, agents, commands, hooks) loaded into every Claude session.
        Applies to sessions started after the change.
      </p>
      <button
        onClick={() => void add()}
        className="flex items-center gap-1.5 rounded-md bg-sky-700 px-3 py-1.5 text-sm text-white hover:bg-sky-600"
      >
        <FolderPlus size={14} /> Add plugin folder…
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="space-y-1.5">
        {plugins.length === 0 && <p className="text-sm text-slate-500">No plugins installed.</p>}
        {plugins.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          >
            <Puzzle size={14} className="shrink-0 text-slate-500" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-slate-200">{p.name}</div>
              <div className="truncate font-mono text-xs text-slate-500">{p.path}</div>
            </div>
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={p.enabled}
                onChange={(e) =>
                  void window.chimera.setPluginEnabled(p.id, e.target.checked).then(refresh)
                }
              />
              enabled
            </label>
            <button
              onClick={() => void window.chimera.removePlugin(p.id).then(refresh)}
              className="text-slate-600 hover:text-red-400"
              title="Remove plugin"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
