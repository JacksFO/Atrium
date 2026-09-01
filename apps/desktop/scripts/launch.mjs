/**
 * Launch Electron with a clean environment.
 *
 * VS Code sets ELECTRON_RUN_AS_NODE=1 in its integrated terminal for its own
 * tooling. Any Electron app started from that terminal inherits it and boots
 * as plain Node instead: `require('electron')` then returns the path to the
 * executable rather than the API object, and the app dies on the first
 * `protocol.` or `app.` call with a confusing "cannot read properties of
 * undefined".
 *
 * Stripping it here means `pnpm dev` behaves the same from VS Code, Windows
 * Terminal, or a shortcut.
 */
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  windowsHide: false,
})

child.on('close', (code) => process.exit(code ?? 0))
