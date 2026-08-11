import { useEffect, useState } from 'react'
import { Puzzle, Trash2, FolderPlus, GitBranch, Loader2, RefreshCw, Check, Search, ShieldAlert } from 'lucide-react'
import type { PluginInspection } from '../../../../shared/plugins'

interface PluginRow {
  id: string
  name: string
  path: string
  enabled: boolean
  gitUrl: string | null
}

export function PluginsPane() {
  const [plugins, setPlugins] = useState<PluginRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [gitUrl, setGitUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const [updated, setUpdated] = useState<string | null>(null)
  const [inspections, setInspections] = useState<Record<string, PluginInspection>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    const [nextPlugins, details] = await Promise.all([
      window.chimera.listPlugins(),
      window.chimera.inspectPlugins()
    ])
    setPlugins(nextPlugins)
    setInspections(Object.fromEntries(details.map((detail) => [detail.id, detail])))
    setSelected((ids) => ids.filter((id) => nextPlugins.some((plugin) => plugin.id === id)))
  }

  useEffect(() => {
    void refresh()
  }, [])

  const addFolder = async (): Promise<void> => {
    setError(null)
    try {
      const added = await window.chimera.addPlugin()
      if (added) await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const installFromGit = async (): Promise<void> => {
    if (!gitUrl.trim() || installing) return
    setError(null)
    setInstalling(true)
    try {
      const installed = await window.chimera.installPluginsFromGit(gitUrl.trim())
      setGitUrl('')
      await refresh()
      if (installed.length > 1) {
        setError(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(false)
    }
  }

  const update = async (id: string): Promise<void> => {
    setError(null)
    setUpdating(id)
    try {
      await window.chimera.updatePlugin(id)
      setUpdated(id)
      setTimeout(() => setUpdated(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUpdating(null)
    }
  }

  const confirmHooks = (targets: PluginRow[]): boolean => {
    const names = targets.filter((plugin) => inspections[plugin.id]?.hasHooks).map((plugin) => plugin.name)
    return names.length === 0 || window.confirm(`Enable plugins containing executable hooks?\n\n${names.join('\n')}\n\nHooks run with the agent's permissions.`)
  }

  const setEnabled = async (targets: PluginRow[], enabled: boolean): Promise<void> => {
    if (enabled && !confirmHooks(targets)) return
    setBulkBusy(true)
    setError(null)
    try {
      for (const plugin of targets) await window.chimera.setPluginEnabled(plugin.id, enabled)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBulkBusy(false)
    }
  }

  const updateAll = async (): Promise<void> => {
    const unique = [...new Map(plugins.filter((plugin) => plugin.gitUrl).map((plugin) => [plugin.gitUrl, plugin])).values()]
    setBulkBusy(true)
    setError(null)
    try {
      for (const plugin of unique) await window.chimera.updatePlugin(plugin.id)
      setUpdated('all')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBulkBusy(false)
    }
  }

  const visible = plugins.filter((plugin) => {
    const query = search.trim().toLowerCase()
    if (!query) return true
    const detail = inspections[plugin.id]
    return [plugin.name, plugin.path, plugin.gitUrl, detail?.description].some((value) => value?.toLowerCase().includes(query))
  })
  const selectedPlugins = plugins.filter((plugin) => selected.includes(plugin.id))

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Claude Code plugins (skills, agents, commands, hooks) loaded into every Claude session.
        Changes apply to sessions started afterwards. Only install plugins from sources you trust —
        they run with the agent's permissions.
      </p>

      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <GitBranch size={13} className="absolute top-2.5 left-2 text-slate-500" />
          <input
            value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void installFromGit()}
            placeholder="github.com/owner/repo  or  owner/repo"
            className="w-full rounded-md border border-[#30363d] bg-[#161b22] py-1.5 pr-2 pl-7 font-mono text-xs"
          />
        </div>
        <button
          onClick={() => void installFromGit()}
          disabled={!gitUrl.trim() || installing}
          className="flex items-center gap-1.5 rounded-md bg-sky-700 px-3 py-1.5 text-sm text-white hover:bg-sky-600 disabled:opacity-40"
        >
          {installing ? <Loader2 size={14} className="animate-spin" /> : 'Install'}
        </button>
        <button
          onClick={() => void addFolder()}
          title="Add a local plugin folder"
          className="flex items-center gap-1.5 rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-slate-300 hover:bg-[#21262d]"
        >
          <FolderPlus size={14} />
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {plugins.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#30363d] bg-[#10151c] p-2">
          <div className="relative min-w-[180px] flex-1">
            <Search size={13} className="absolute top-2 left-2 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plugins" className="w-full rounded border border-[#30363d] bg-[#0d1117] py-1.5 pr-2 pl-7 text-xs" />
          </div>
          <span className="text-xs text-slate-500">{selected.length} selected</span>
          <button disabled={selected.length === 0 || bulkBusy} onClick={() => void setEnabled(selectedPlugins, true)} className="rounded border border-[#30363d] px-2 py-1 text-xs text-slate-300 disabled:opacity-40">Enable</button>
          <button disabled={selected.length === 0 || bulkBusy} onClick={() => void setEnabled(selectedPlugins, false)} className="rounded border border-[#30363d] px-2 py-1 text-xs text-slate-300 disabled:opacity-40">Disable</button>
          <button disabled={!plugins.some((p) => p.gitUrl) || bulkBusy} onClick={() => void updateAll()} className="flex items-center gap-1 rounded border border-[#30363d] px-2 py-1 text-xs text-slate-300 disabled:opacity-40"><RefreshCw size={12} /> Update all</button>
        </div>
      )}

      <div className="space-y-1.5">
        {plugins.length === 0 && <p className="text-sm text-slate-500">No plugins installed.</p>}
        {visible.map((p) => {
          const detail = inspections[p.id]
          return (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          >
            <input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id))} aria-label={`Select ${p.name}`} />
            <Puzzle size={14} className="shrink-0 text-slate-500" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm text-slate-200">
                {p.name}
                {p.gitUrl && (
                  <span title={p.gitUrl}>
                    <GitBranch size={11} className="text-slate-500" />
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-xs text-slate-500">
                {p.gitUrl ?? p.path}
              </div>
              {detail?.description && <div className="mt-0.5 line-clamp-2 text-xs text-slate-400">{detail.description}</div>}
              {detail && (
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
                  {detail.version && <span className="rounded bg-[#21262d] px-1.5 py-0.5">v{detail.version}</span>}
                  {Object.entries(detail.capabilities).filter(([, count]) => count > 0).map(([name, count]) => <span key={name} className="rounded bg-[#21262d] px-1.5 py-0.5">{count} {name}</span>)}
                  {detail.health !== 'ready' && <span title={detail.issue ?? undefined} className="flex items-center gap-1 rounded bg-red-950/50 px-1.5 py-0.5 text-red-300"><ShieldAlert size={10} /> {detail.health}</span>}
                </div>
              )}
            </div>
            {p.gitUrl && (
              <button
                onClick={() => void update(p.id)}
                disabled={updating !== null}
                title="Pull latest from the repo"
                className="text-slate-500 hover:text-sky-300 disabled:opacity-40"
              >
                {updating === p.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : updated === p.id ? (
                  <Check size={14} className="text-emerald-400" />
                ) : (
                  <RefreshCw size={14} />
                )}
              </button>
            )}
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={p.enabled}
                onChange={(e) => void setEnabled([p], e.target.checked)}
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
          )
        })}
      </div>
    </div>
  )
}
