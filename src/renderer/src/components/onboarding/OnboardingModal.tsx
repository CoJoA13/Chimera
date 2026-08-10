import { CircleCheck, CircleAlert, Sparkles } from 'lucide-react'
import { useChat } from '../../stores/chat'
import type { AuthStatus } from '../../../../shared/ipc'

function ProviderCard({
  name,
  auth,
  note,
  onLogin
}: {
  name: string
  auth: AuthStatus | null
  note: string
  onLogin: () => void
}) {
  const ok = auth?.state === 'authenticated'
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-200">{name}</span>
        {ok ? (
          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <CircleCheck size={13} /> Connected
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-amber-400">
            <CircleAlert size={13} />
            {auth?.state === 'cli-missing' ? 'CLI missing' : 'Not signed in'}
          </span>
        )}
        {!ok && auth?.state !== 'cli-missing' && (
          <button
            onClick={onLogin}
            className="ml-auto rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-500"
          >
            Log in
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  )
}

export function OnboardingModal() {
  const open = useChat((s) => s.onboardingOpen)
  const auth = useChat((s) => s.auth)
  const codexAuth = useChat((s) => s.codexAuth)
  const login = useChat((s) => s.login)
  const finish = useChat((s) => s.finishOnboarding)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[520px] max-w-[92vw] rounded-xl border border-[#30363d] bg-[#10151c] p-5 shadow-2xl">
        <div className="mb-1 flex items-center gap-2">
          <Sparkles size={18} className="text-cyan-400" />
          <span className="text-lg font-semibold text-slate-100">Welcome to Chimera</span>
        </div>
        <p className="mb-4 text-sm text-slate-400">
          Multi-provider AI chat with a cross-agent bus: group chats, conferences, memory,
          schedules, and watchers. Connect at least one provider to begin — logins run in your own
          terminal via the official CLIs; Chimera never sees your credentials.
        </p>
        <div className="space-y-2">
          <ProviderCard
            name="Claude"
            auth={auth}
            note="Uses your Claude Code CLI login (claude /login) or ANTHROPIC_API_KEY."
            onLogin={() => void login('claude')}
          />
          <ProviderCard
            name="OpenAI Codex"
            auth={codexAuth}
            note="Uses the codex CLI with your ChatGPT account (codex login)."
            onLogin={() => void login('codex')}
          />
        </div>
        <div className="mt-4 flex items-center">
          <p className="text-xs text-slate-600">Tip: Ctrl+K searches everything.</p>
          <button
            onClick={() => void finish()}
            className="ml-auto rounded-md bg-sky-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-600"
          >
            Get started
          </button>
        </div>
      </div>
    </div>
  )
}
