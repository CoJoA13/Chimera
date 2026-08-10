import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const TERMINALS: { cmd: string; args: (command: string) => string[] }[] = [
  { cmd: '/usr/bin/ptyxis', args: (c) => ['--', 'bash', '-c', c] },
  { cmd: '/usr/bin/gnome-terminal', args: (c) => ['--', 'bash', '-c', c] },
  { cmd: '/usr/bin/konsole', args: (c) => ['-e', 'bash', '-c', c] },
  { cmd: '/usr/bin/xterm', args: (c) => ['-e', 'bash', '-c', c] }
]

/**
 * Opens the user's terminal emulator running the given command.
 * Used for provider login flows — Chimera never handles OAuth itself.
 */
export function launchInTerminal(command: string): void {
  for (const term of TERMINALS) {
    if (existsSync(term.cmd)) {
      const child = spawn(term.cmd, term.args(command), { detached: true, stdio: 'ignore' })
      child.unref()
      return
    }
  }
  throw new Error('No supported terminal emulator found (ptyxis/gnome-terminal/konsole/xterm)')
}
