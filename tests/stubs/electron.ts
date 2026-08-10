/** Minimal electron stub so main-process modules run under vitest. */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'chimera-test-'))

export const app = {
  getPath: () => userData,
  getAppPath: () => process.cwd(),
  isPackaged: false
}

export class Notification {
  static isSupported(): boolean {
    return false
  }
  on(): void {}
  show(): void {}
}

export const BrowserWindow = {
  fromWebContents: (): null => null
}

export const dialog = {}
export const ipcMain = { handle: (): void => {} }
export type WebContents = unknown
