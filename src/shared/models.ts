export type ProviderId = 'claude' | 'codex'

export interface ModelInfo {
  id: string
  name: string
  provider: ProviderId
  description?: string
}

export const MODEL_CATALOG: Record<ProviderId, ModelInfo[]> = {
  claude: [
    {
      id: 'claude-fable-5',
      name: 'Fable 5',
      provider: 'claude',
      description: 'Most capable — Mythos-class'
    },
    { id: 'claude-opus-5', name: 'Opus 5', provider: 'claude', description: 'Deep reasoning' },
    { id: 'claude-sonnet-5', name: 'Sonnet 5', provider: 'claude', description: 'Balanced' },
    {
      id: 'claude-haiku-4-5-20251001',
      name: 'Haiku 4.5',
      provider: 'claude',
      description: 'Fast and economical'
    }
  ],
  codex: [
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'codex', description: 'Codex default' }
  ]
}

export const DEFAULT_MODEL: Record<ProviderId, string> = {
  claude: 'claude-sonnet-5',
  codex: 'gpt-5.6-sol'
}
