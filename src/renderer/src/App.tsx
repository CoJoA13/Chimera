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
import { CwdButton } from './components/chat/CwdButton'
import { PersonaButton } from './components/chat/PersonaButton'
import { ControlRoom } from './components/control/ControlRoom'
import { TemplateButton } from './components/chat/TemplateButton'
import { GroupMembersPopover } from './components/chat/GroupMembersPopover'
import { ForkButton } from './components/chat/ForkButton'
import { CommandPalette } from './components/palette/CommandPalette'
import { OnboardingModal } from './components/onboarding/OnboardingModal'
import { PermissionDialog } from './components/permissions/PermissionDialog'
import { SettingsModal } from './components/settings/SettingsModal'

export default function App() {
  const auth = useChat((s) => s.auth)
  const init = useChat((s) => s.init)
  const login = useChat((s) => s.login)
  const activeView = useChat((s) => s.activeView)
  const activeIsGroup = useChat(
    (s) => s.conversations.find((c) => c.id === s.activeConvId)?.kind === 'group'
  )
  const groupMemberNames = useChat((s) => {
    const conv = s.conversations.find((c) => c.id === s.activeConvId)
    return conv?.kind === 'group' ? conv.groupMembers?.map((m) => m.title).join(' · ') : undefined
  })
  const title = useChat((s) =>
    s.activeView === 'control'
      ? 'Control Room'
      : (s.conversations.find((c) => c.id === s.activeConvId)?.title ?? 'Chimera')
  )

  useEffect(() => {
    void init()
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const state = useChat.getState()
      if (e.key === 'k') {
        e.preventDefault()
        state.setPaletteOpen(!state.paletteOpen)
      } else if (e.key === 'n') {
        e.preventDefault()
        state.setNewChatOpen(true)
      } else if (/^[1-9]$/.test(e.key)) {
        const conv = state.conversations[Number(e.key) - 1]
        if (conv) {
          e.preventDefault()
          void state.selectConversation(conv.id)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
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
          {activeView === 'chat' && !activeIsGroup && (
            <>
              <ModelPicker />
              <McpPopover />
              <CwdButton />
              <PersonaButton />
              <PermissionModeBadge />
              <ForkButton />
            </>
          )}
          {activeView === 'chat' && activeIsGroup && <GroupMembersPopover />}
          {activeView === 'chat' && activeIsGroup && groupMemberNames && (
            <span className="truncate text-xs text-slate-500">{groupMemberNames}</span>
          )}
          {activeView === 'chat' && <TemplateButton />}
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
        {activeView === 'chat' ? (
          <>
            <ChatView />
            <BusStatusStrip />
            <Composer />
          </>
        ) : (
          <ControlRoom />
        )}
      </div>
      <PermissionDialog />
      <SettingsModal />
      <CommandPalette />
      <OnboardingModal />
    </div>
  )
}
