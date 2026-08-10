import type { ProviderId } from '../../shared/models'
import type { ChatProvider } from './types'
import { ClaudeProvider } from './claude/ClaudeProvider'
import { CodexProvider } from './codex/CodexProvider'

const providers = new Map<ProviderId, ChatProvider>()

export function getProvider(id: ProviderId): ChatProvider {
  let provider = providers.get(id)
  if (!provider) {
    provider = id === 'claude' ? new ClaudeProvider() : new CodexProvider()
    providers.set(id, provider)
  }
  return provider
}
