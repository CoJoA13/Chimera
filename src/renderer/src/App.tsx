import { useEffect } from 'react'
import { CircleCheck, CircleAlert } from 'lucide-react'
import { useChat } from './stores/chat'
import { Sidebar } from './components/sidebar/Sidebar'
import { ChatView } from './components/chat/ChatView'
import { Composer } from './components/chat/Composer'
import { ModelPicker } from './components/chat/ModelPicker'
import { McpPopover } from './components/chat/McpPopover'
import { PermissionModeBadge } from './components/chat/PermissionModeBadge'
import { BusStatusStrip } from './components/chat/BusStatusStrip'
import { PermissionDialog } from './components/permissions/PermissionDialog'
import { SettingsModal } from './components/settings/SettingsModal'

export default function App() {
  const auth = useChat((s) => s.auth)
  const init = useChat((s) => s.init)
  const login = useChat((s) => s.login)
  const title = useChat(
    (s) => s.conversations.find((c) => c.id === s.activeConvId)?.title ?? 'Chimera'
  )

  useEffect(() => {
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-[#21262d] px-4 py-2.5">
          <span className="max-w-[240px] truncate text-sm font-semibold tracking-wide text-slate-100">
            {title}
          </span>
          <ModelPicker />
          <McpPopover />
          <PermissionModeBadge />
          <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
            {auth?.state === 'authenticated' ? (
              <>
                <CircleCheck size={13} className="text-emerald-400" />
                Claude · {auth.method === 'api-key' ? 'API key' : 'CLI login'}
              </>
            ) : auth ? (
              <>
                <CircleAlert size={13} className="text-amber-400" />
                Not signed in
                <button
                  onClick={() => void login()}
                  className="ml-1 rounded-md bg-amber-600/80 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-500"
                >
                  Log in
                </button>
              </>
            ) : null}
          </span>
        </header>
        <ChatView />
        <BusStatusStrip />
        <Composer />
      </div>
      <PermissionDialog />
      <SettingsModal />
    </div>
  )
}
