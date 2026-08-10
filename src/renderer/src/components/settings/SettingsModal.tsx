import { useState } from 'react'
import { X, CircleCheck, CircleAlert } from 'lucide-react'
import { useChat } from '../../stores/chat'
import { McpPane } from './McpPane'
import { ConnectorsPane } from './ConnectorsPane'
import { PluginsPane } from './PluginsPane'

const TABS = ['Providers', 'MCP Servers', 'Connectors', 'Plugins'] as const

export function SettingsModal() {
  const open = useChat((s) => s.settingsOpen)
  const setOpen = useChat((s) => s.setSettingsOpen)
  const auth = useChat((s) => s.auth)
  const codexAuth = useChat((s) => s.codexAuth)
  const login = useChat((s) => s.login)
  const [tab, setTab] = useState<(typeof TABS)[number]>('Providers')

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="flex h-[560px] w-[720px] max-w-[95vw] flex-col rounded-xl border border-[#30363d] bg-[#10151c] shadow-2xl">
        <div className="flex items-center border-b border-[#21262d] px-4 py-3">
          <span className="font-medium text-slate-100">Settings</span>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto text-slate-500 hover:text-slate-200"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-44 shrink-0 border-r border-[#21262d] p-2">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`mb-0.5 block w-full rounded-md px-3 py-2 text-left text-sm ${
                  tab === t ? 'bg-[#1c2431] text-slate-100' : 'text-slate-400 hover:bg-[#161b22]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {tab === 'Providers' && (
              <div className="space-y-3">
                <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-200">Claude</span>
                    {auth?.state === 'authenticated' ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-400">
                        <CircleCheck size={13} />
                        {auth.method === 'api-key' ? 'API key' : 'Account login'}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-amber-400">
                        <CircleAlert size={13} /> Not signed in
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Uses your own Claude Code CLI login (or ANTHROPIC_API_KEY). Chimera never
                    handles the OAuth flow itself.
                  </p>
                  {auth?.state !== 'authenticated' && (
                    <button
                      onClick={() => void login()}
                      className="mt-3 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500"
                    >
                      Log in via terminal
                    </button>
                  )}
                </div>
                <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-200">OpenAI Codex</span>
                    {codexAuth?.state === 'authenticated' ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-400">
                        <CircleCheck size={13} /> ChatGPT login
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-amber-400">
                        <CircleAlert size={13} />
                        {codexAuth?.state === 'cli-missing' ? 'CLI missing' : 'Not signed in'}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Uses the official codex CLI with your ChatGPT account ({codexAuth?.detail}).
                  </p>
                  {codexAuth?.state === 'unauthenticated' && (
                    <button
                      onClick={() => void login('codex')}
                      className="mt-3 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500"
                    >
                      Log in via terminal
                    </button>
                  )}
                </div>
              </div>
            )}
            {tab === 'MCP Servers' && <McpPane />}
            {tab === 'Connectors' && <ConnectorsPane />}
            {tab === 'Plugins' && <PluginsPane />}
          </div>
        </div>
      </div>
    </div>
  )
}
