/**
 * Measure markup in a real browser engine.
 *
 * Under Electron rather than a DOM shim, because the question is what a
 * browser's own stylesheet does to a <button> before ours gets a say - and a
 * shim has no such stylesheet, so it would agree with whatever the rules say
 * and prove nothing.
 *
 * What is left measures the desktop's splash screen, which is plain HTML this
 * repo still ships and still owns.
 *
 * There were fourteen more, and they went. Every one was written against the
 * client that was replaced and measured class names it took with it -
 * act-card, dmp-banner, rail-icon, stage-cell - so once their paths were
 * repointed at the one stylesheet that survived they rendered unstyled boxes
 * and measured those: thirteen failing on forty-nine assertions, and two
 * hanging the runner for ninety seconds each.
 *
 * They were not portable. The numbers they expected were the old design's -
 * borders and insets that no longer exist - so rewriting them would have
 * meant deciding afresh what the current design ought to be, assertion by
 * assertion, which is writing new specs rather than fixing old ones. The
 * browser suite in test/ui asks the same questions of the client that exists,
 * with the real stylesheet, off-screen, and is green.
 *
 * Two things were fixed on the way rather than left. Reading a file that is
 * not there throws in Electron's main process, and an uncaught throw there is
 * a modal dialog on somebody's screen rather than a line in a log - which is
 * how this was found. And the windows opened in front of whoever was at the
 * machine, where test/ui puts its own off the side of the screen.
 */
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')

/* Generous: the slowest of these takes a few seconds, and a laptop under
   load is slower again. Anything past this is stuck, not slow. */
const STUCK_AFTER = 90_000

// Electron is a dependency of the desktop app and pnpm does not hoist it to
// the root, so it lives where it was installed.
const BINARY = join(ROOT, 'apps', 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
if (!existsSync(BINARY)) {
  console.error(`no electron at ${BINARY} - run pnpm install first`)
  process.exit(1)
}

/*
 * This shell has ELECTRON_RUN_AS_NODE set, which makes the binary behave as
 * plain node: no window, no browser engine, and require('electron') throws.
 * It has to come off for the whole point of running under Electron to hold.
 */
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

/*
 * Named on the command line, or all of them.
 *
 * This used to default to rail-tiles.cjs, which meant every measurement
 * written after it only ran if somebody remembered to name it - and a guard
 * nobody runs is not a guard. Each one still gets its own Electron process:
 * they are cheap, and one crashing must not take the rest with it.
 */
const named = process.argv[2]
const specs = named
  ? [named]
  : readdirSync(HERE).filter((f) => f.endsWith('.cjs')).sort()

let failed = 0
for (const spec of specs) {
  if (specs.length > 1) console.log(`\n--- ${spec} ---`)
  const code = await new Promise((done) => {
    const child = spawn(BINARY, [join(HERE, spec)], { env, stdio: 'inherit' })
    /*
     * A spec that hangs must not hang the run.
     *
     * away.cjs waited on requestAnimationFrame, which only fires for a window
     * the compositor is drawing - true when that spec has the screen to
     * itself, false when it is one of thirteen behind the others. It sat
     * there for ten minutes and would have sat there all day. A spec that
     * stops answering should fail, loudly, and let the rest go on.
     */
    const bomb = setTimeout(() => {
      console.log(`  the spec stopped answering after ${STUCK_AFTER / 1000}s - killed`)
      child.kill()
      done(1)
    }, STUCK_AFTER)
    child.on('exit', (c) => { clearTimeout(bomb); done(c ?? 1) })
  })
  if (code !== 0) failed += 1
}

if (specs.length > 1) {
  console.log(failed === 0
    ? `\nall ${specs.length} measurements passed`
    : `\n${failed} of ${specs.length} measurements failed`)
}
process.exit(failed === 0 ? 0 : 1)
