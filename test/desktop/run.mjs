/**
 * Bundle the real badge module, then drive it through a real Electron window.
 *
 * The module is TypeScript and the renderer cannot read that, so esbuild turns
 * it into one script first. Bundled from source on every run rather than
 * checked in, so this can never end up testing a stale copy of the thing it
 * is supposed to be testing.
 */
import { spawnSync, spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const WORK = join(tmpdir(), 'atrium-desktop-test')
mkdirSync(WORK, { recursive: true })

const ELECTRON = join(ROOT, 'apps', 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
if (!existsSync(ELECTRON)) {
  console.error(`no electron at ${ELECTRON} - run pnpm install first`)
  process.exit(1)
}

/*
 * esbuild ships as a platform binary under pnpm's store and is not resolvable
 * from the root, so it is found rather than imported. Newest first: any of
 * them can do this, and the newest is the one the app itself builds with.
 */
const store = join(ROOT, 'node_modules', '.pnpm')
const candidates = readdirSync(store)
  .filter((d) => d.startsWith('@esbuild+win32-x64@'))
  .sort()
  .reverse()
  .map((d) => join(store, d, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'))
  .filter((p) => existsSync(p))

if (!candidates.length) {
  console.error('no esbuild binary found under node_modules/.pnpm')
  process.exit(1)
}

const bundle = join(WORK, 'badge.bundle.js')
const built = spawnSync(candidates[0], [
  join(ROOT, 'apps', 'client', 'src', 'lib', 'badge.ts'),
  '--bundle',
  '--format=iife',
  '--global-name=Badge',
  `--outfile=${bundle}`,
], { encoding: 'utf8' })

if (built.status !== 0) {
  console.error('could not bundle the badge module:')
  console.error(built.stderr || built.stdout)
  process.exit(1)
}

// ELECTRON_RUN_AS_NODE is set in this shell, which makes the binary behave as
// plain node - no window, no browser engine, and none of what this measures.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

/*
 * Which check to run. There is more than one desktop check now, and they want
 * the same setup - the binary found, and the shell's node-mode flag stripped.
 * Only the badge check needs the bundle.
 */
const which = process.argv[2] ?? 'badge.cjs'
const args = which === 'badge.cjs' ? [join(HERE, which), bundle] : [join(HERE, which)]
const child = spawn(ELECTRON, args, { env, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 1))
