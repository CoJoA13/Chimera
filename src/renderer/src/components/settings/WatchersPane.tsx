import { useEffect, useState } from 'react'
import { Eye, Trash2, FolderOpen, GitCommitHorizontal } from 'lucide-react'
import { useChat } from '../../stores/chat'

interface WatcherRow {
  id: string
  conversationId: string
  path: string
  kind: 'files' | 'git'
  prompt: string
  enabled: boolean
}

export function WatchersPane() {
  const conversations = useChat((s) => s.conversations)
  const [watchers, setWatchers] = useState<WatcherRow[]>([])
  const [convId, setConvId] = useState('')
  const [path, setPath] = useState('')
  const [kind, setKind] = useState<'files' | 'git'>('git')
  const [prompt, setPrompt] = useState('')

  const refresh = async (): Promise<void> => {
    setWatchers(await window.chimera.listWatchers())
  }

  useEffect(() => {
    void refresh()
  }, [])

  const pickPath = async (): Promise<void> => {
    const picked = await window.chimera.pickFolder()
    if (picked) setPath(picked)
  }

  const add = async (): Promise<void> => {
    if (!convId || !path || !prompt.trim()) return
    await window.chimera.addWatcher(convId, path, kind, prompt.trim())
    setPrompt('')
    await refresh()
  }

  const titleOf = (id: string): string =>
    conversations.find((c) => c.id === id)?.title ?? 'deleted conversation'

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Watchers trigger an agent when something happens: new git commits (checked every minute) or
        file changes (debounced 5s). The prompt fires into the conversation like a normal message.
      </p>

      <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
        <div className="flex gap-2">
          <select
            value={convId}
            onChange={(e) => setConvId(e.target.value)}
            className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm"
          >
            <option value="">Choose a conversation…</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} {c.kind === 'group' ? '(group)' : ''}
              </option>
            ))}
          </select>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'files' | 'git')}
            className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm"
          >
            <option value="git">Git commits</option>
            <option value="files">File changes</option>
          </select>
        </div>
        <div className="flex gap-2">
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/to/repo-or-folder"
            className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 font-mono text-sm"
          />
          <button
            onClick={() => void pickPath()}
            className="rounded border border-[#30363d] px-2 text-slate-400 hover:bg-[#21262d]"
            title="Browse"
          >
            <FolderOpen size={14} />
          </button>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should the agent do when this triggers?"
          rows={2}
          className="w-full resize-none rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => void add()}
          disabled={!convId || !path || !prompt.trim()}
          className="rounded-md bg-sky-700 px-3 py-1.5 text-sm text-white hover:bg-sky-600 disabled:opacity-40"
        >
          Add watcher
        </button>
      </div>

      <div className="space-y-1.5">
        {watchers.length === 0 && <p className="text-sm text-slate-500">No watchers yet.</p>}
        {watchers.map((w) => (
          <div
            key={w.id}
            className="flex items-center gap-3 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          >
            {w.kind === 'git' ? (
              <GitCommitHorizontal size={14} className="shrink-0 text-slate-500" />
            ) : (
              <Eye size={14} className="shrink-0 text-slate-500" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm text-slate-200">
                {titleOf(w.conversationId)}
                <span className="ml-2 font-mono text-xs text-slate-500">{w.path}</span>
              </div>
              <div className="truncate text-xs text-slate-500">{w.prompt}</div>
            </div>
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={w.enabled}
                onChange={(e) =>
                  void window.chimera.setWatcherEnabled(w.id, e.target.checked).then(refresh)
                }
              />
              on
            </label>
            <button
              onClick={() => void window.chimera.removeWatcher(w.id).then(refresh)}
              className="text-slate-600 hover:text-red-400"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
