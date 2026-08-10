import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const AUTOSTART_FILE = join(homedir(), '.config', 'autostart', 'chimera.desktop')

/** The command that relaunches this exact install (AppImage path when packaged). */
function launchCommand(): string {
  return process.env.APPIMAGE ?? process.execPath
}

export function isAutostartEnabled(): boolean {
  return existsSync(AUTOSTART_FILE)
}

export function setAutostart(enabled: boolean): void {
  if (!enabled) {
    rmSync(AUTOSTART_FILE, { force: true })
    return
  }
  mkdirSync(join(homedir(), '.config', 'autostart'), { recursive: true })
  writeFileSync(
    AUTOSTART_FILE,
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Chimera',
      'Comment=Multi-agent AI chat — schedules, watchers, and missions run while open',
      `Exec="${launchCommand()}"`,
      'X-GNOME-Autostart-enabled=true',
      ''
    ].join('\n')
  )
}

/** Warn when autostart points at a dev electron binary rather than an install. */
export function autostartNote(): string | null {
  if (!app.isPackaged && !process.env.APPIMAGE) {
    return 'Running from source — autostart will point at the dev electron binary until you use the packaged app.'
  }
  return null
}
