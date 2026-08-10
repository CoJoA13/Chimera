import { useEffect, useState } from 'react'
import { Plus, Trash2, Import, Server } from 'lucide-react'
import type { ClaudeDesktopImportCandidate, McpServerRecord } from '../../../../shared/config-types'

export function McpPane() {
  const [servers, setServers] = useState<McpServerRecord[]>([])
  const [candidates, setCandidates] = useState<ClaudeDesktopImportCandidate[] | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'stdio' as 'stdio' | 'http' | 'sse', command: '', args: '', url: '' })

  const refresh = async (): Promise<void> => {
    setServers(await window.chimera.listMcpServers())
  }

  useEffect(() => {
    void refresh()
  }, [])

  const add = async (): Promise<void> => {
    if (!form.name) return
    const transport =
      form.type === 'stdio'
        ? {
            type: 'stdio' as const,
            command: form.command,
            args: form.args ? form.args.split(/\s+/) : undefined
          }
        : { type: form.type, url: form.url }
    await window.chimera.addMcpServer(form.name, transport)
    setForm({ name: '', type: 'stdio', command: '', args: '', url: '' })
    setShowAdd(false)
    await refresh()
  }

  const loadCandidates = async (): Promise<void> => {
    setCandidates(await window.chimera.mcpImportCandidates())
  }

  const importSelected = async (names: string[]): Promise<void> => {
    await window.chimera.mcpImport(names)
    setCandidates(null)
    await refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 rounded-md bg-sky-700 px-3 py-1.5 text-sm text-white hover:bg-sky-600"
        >
          <Plus size={14} /> Add server
        </button>
        <button
          onClick={() => void loadCandidates()}
          className="flex items-center gap-1.5 rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-slate-300 hover:bg-[#21262d]"
        >
          <Import size={14} /> Import from Claude Desktop
        </button>
      </div>

      {showAdd && (
        <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
          <div className="flex gap-2">
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm"
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}
              className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm"
            >
              <option value="stdio">stdio</option>
              <option value="http">HTTP</option>
              <option value="sse">SSE</option>
            </select>
          </div>
          {form.type === 'stdio' ? (
            <div className="flex gap-2">
              <input
                placeholder="Command (e.g. npx)"
                value={form.command}
                onChange={(e) => setForm({ ...form, command: e.target.value })}
                className="w-40 rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm font-mono"
              />
              <input
                placeholder="Arguments"
                value={form.args}
                onChange={(e) => setForm({ ...form, args: e.target.value })}
                className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm font-mono"
              />
            </div>
          ) : (
            <input
              placeholder="https://…"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm font-mono"
            />
          )}
          <button
            onClick={() => void add()}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-600"
          >
            Save
          </button>
        </div>
      )}

      {candidates && (
        <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
          <p className="mb-2 text-sm text-slate-300">Found in Claude Desktop config:</p>
          {candidates.length === 0 && <p className="text-sm text-slate-500">No servers found.</p>}
          <ImportChecklist candidates={candidates} onImport={importSelected} />
        </div>
      )}

      <div className="space-y-1.5">
        {servers.length === 0 && (
          <p className="text-sm text-slate-500">No MCP servers configured.</p>
        )}
        {servers.map((server) => (
          <div
            key={server.id}
            className="flex items-center gap-3 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          >
            <Server size={14} className="shrink-0 text-slate-500" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-slate-200">{server.name}</div>
              <div className="truncate font-mono text-xs text-slate-500">
                {server.transport.type === 'stdio'
                  ? `${server.transport.command} ${(server.transport.args ?? []).join(' ')}`
                  : server.transport.url}
              </div>
            </div>
            <span className="rounded bg-[#21262d] px-1.5 py-0.5 text-[10px] tracking-wide text-slate-400 uppercase">
              {server.transport.type}
            </span>
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={server.enabledByDefault}
                onChange={(e) => {
                  void window.chimera
                    .setMcpDefault(server.id, e.target.checked)
                    .then(refresh)
                }}
              />
              default
            </label>
            <button
              onClick={() => void window.chimera.removeMcpServer(server.id).then(refresh)}
              className="text-slate-600 hover:text-red-400"
              title="Remove server"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ImportChecklist({
  candidates,
  onImport
}: {
  candidates: ClaudeDesktopImportCandidate[]
  onImport: (names: string[]) => Promise<void>
}) {
  const [selected, setSelected] = useState<string[]>(
    candidates.filter((c) => !c.alreadyImported).map((c) => c.name)
  )
  return (
    <div>
      {candidates.map((c) => (
        <label key={c.name} className="flex items-center gap-2 py-1 text-sm text-slate-300">
          <input
            type="checkbox"
            disabled={c.alreadyImported}
            checked={selected.includes(c.name)}
            onChange={(e) =>
              setSelected(
                e.target.checked ? [...selected, c.name] : selected.filter((n) => n !== c.name)
              )
            }
          />
          {c.name}
          {c.alreadyImported && <span className="text-xs text-slate-600">(already imported)</span>}
        </label>
      ))}
      {candidates.some((c) => !c.alreadyImported) && (
        <button
          onClick={() => void onImport(selected)}
          className="mt-2 rounded bg-sky-700 px-3 py-1.5 text-sm text-white hover:bg-sky-600"
        >
          Import selected
        </button>
      )}
    </div>
  )
}
