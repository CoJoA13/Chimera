import { useChat } from '../../stores/chat'

export function ModelPicker() {
  const active = useChat((s) => s.conversations.find((c) => c.id === s.activeConvId))
  const models = useChat((s) => s.models)
  const changeModel = useChat((s) => s.changeModel)
  const providerModels = models.filter((m) => m.provider === (active?.provider ?? 'claude'))

  return (
    <select
      value={active?.model ?? ''}
      onChange={(e) => void changeModel(e.target.value)}
      className="rounded-md border border-[#30363d] bg-[#161b22] px-2 py-1 text-sm text-slate-300 focus:outline-none"
    >
      {providerModels.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  )
}
