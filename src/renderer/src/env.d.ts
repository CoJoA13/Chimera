import type { ChimeraApi } from '../../shared/ipc'

declare global {
  interface Window {
    chimera: ChimeraApi
  }
}

export {}
