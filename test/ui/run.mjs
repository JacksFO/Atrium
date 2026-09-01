/**
 * Run the browser tests.
 *
 *   node test/ui/run.mjs             every spec
 *   node test/ui/run.mjs phone       only specs whose name contains "phone"
 *
 * These are the checks the unit tests structurally cannot make. Everything
 * here started as a bug somebody hit while using the app: a button that took
 * its whole row, a menu that shut in the click meant to open it, a member
 * list with no way in below 1180px. All of them rendered without error and
 * all of them were unusable.
 *
 * Two rules this obeys, both learned the hard way:
 *
 *  - It never builds into apps/client/dist. That folder is what the live
 *    server hands to six people, and a test build would replace what they
 *    are using mid-conversation. Everything goes to a scratch directory and
 *    the server is pointed at it with CLIENT_DIST.
 *
 *  - It never stops a server by process name. The live server is an ordinary
 *    node.exe, so `taskkill /IM node.exe` takes everyone offline. Servers
 *    here are found by the port they are listening on and stopped by pid.
 */

import { spawn, execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const PORT = Number(process.env.UI_PORT ?? 8846)
/*
 * Where this run keeps its things, and which client it drives.
 *
 * Both are overridable so that several runs can go at once, which is the
 * difference between porting sixty specs in an evening and in a week. Give
 * each runner its own UI_WORK and UI_PORT, build the client once, and point
 * them all at it with UI_DIST - they then share nothing that can collide.
 */
const WORK = join(tmpdir(), process.env.UI_WORK ?? 'atrium-ui-tests')
const PREBUILT = process.env.UI_DIST ? resolve(process.env.UI_DIST) : null

const only = process.argv[2] ?? ''
const log = (s = '') => process.stdout.write(s + '\n')

/**
 * The electron binary itself, resolved from the workspace that depends on it.
 *
 * Electron belongs to apps/desktop, and pnpm does not hoist it to the root -
 * so requiring it from here finds nothing. The package's main export is the
 * path to the executable.
 */
const ELECTRON = (() => {
  const from = createRequire(join(ROOT, 'apps', 'desktop', 'package.json'))
  try {
    return from('electron')
  } catch {
    throw new Error(
      'electron is not installed. It comes with apps/desktop: run pnpm install.'
    )
  }
})()

/** Whoever is listening on our port, whatever it is. Never by name. */
function listenersOn(port) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' })
    return [...new Set(
      out.split('\n')
        .filter((l) => l.includes(`:${port} `) && l.includes('LISTENING'))
        .map((l) => l.trim().split(/\s+/).pop())
        .filter((p) => /^\d+$/.test(p))
    )]
  } catch {
    return []
  }
}

function stopPort(port) {
  for (const pid of listenersOn(port)) {
    try { process.kill(Number(pid)) } catch { /* already gone */ }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function serverIsUp() {
  try {
    const r = await fetch(`http://localhost:${PORT}/api/members`)
    // 401 is the healthy answer: it is up, and it wants a token.
    return r.status === 401
  } catch {
    return false
  }
}

/** Start a server on a database of its own. */
async function startServer(name) {
  const data = join(WORK, name, 'data')
  const uploads = join(WORK, name, 'uploads')
  rmSync(join(WORK, name), { recursive: true, force: true })
  mkdirSync(data, { recursive: true })
  mkdirSync(uploads, { recursive: true })

  const logFile = join(WORK, name, 'server.log')
  const out = []
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'src/index.ts'],
    {
      cwd: join(ROOT, 'apps', 'server'),
      env: {
        ...process.env,
        DATA_DIR: data,
        UPLOAD_DIR: uploads,
        PORT: String(PORT),
        TLS: 'false',
        OPEN_REGISTRATION: 'true',
        CLIENT_DIST: PREBUILT ?? join(WORK, 'dist'),
        // Never the live one, whatever the shell happens to have set.
        NODE_ENV: 'test',
        /*
         * No GIF provider, ever.
         *
         * The env is inherited, so the moment a real key went into .env every
         * browser run started making real calls to KLIPY on somebody else's
         * quota - a test key is a hundred an hour for the whole server, and a
         * full run opens the picker several times. Specs that need results
         * stub /api/gifs in the page; specs that do not should get an honest
         * "no provider" rather than the internet.
         */
        KLIPY_API_KEY: '',
        GIPHY_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  child.stdout.on('data', (d) => out.push(String(d)))
  child.stderr.on('data', (d) => out.push(String(d)))

  for (let i = 0; i < 45; i++) {
    if (await serverIsUp()) break
    await sleep(1000)
  }
  if (!(await serverIsUp())) {
    log('  the server never came up. Its output:')
    log(out.join('').split('\n').slice(-15).map((l) => '    ' + l).join('\n'))
    throw new Error('server did not start')
  }

  /*
   * There is nothing to read out of the output any more.
   *
   * This used to wait for a claim code and hand it to every spec, because
   * the first account had to claim the install before anything else could
   * sign up. That is gone - people just sign up - so the harness signs its
   * first account up like any other, and this function's only job is to
   * know the server answered.
   */
  return { child, logFile }
}

function runSpec(specPath) {
  return new Promise((done) => {
    const env = {
      ...process.env,
      UI_SPEC: specPath,
      UI_BASE: `http://localhost:${PORT}`,
    }
    /*
     * This shell has ELECTRON_RUN_AS_NODE set, which makes the electron
     * binary behave as plain node - require('electron') then returns a path
     * string and every window call fails. It has to go.
     */
    delete env.ELECTRON_RUN_AS_NODE

    /*
     * The path the electron package exports, not node_modules/.bin.
     *
     * The shim there is a .cmd, which needs shell: true on Windows, and the
     * absolute path then goes through cmd's own parsing and never launches.
     * That failed silently for all five specs at once - and because stderr
     * was being thrown away, they simply reported nothing at all.
     */
    const child = spawn(ELECTRON, [join(HERE, 'electron-main.cjs')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const noise = /^\[|Electron|DevTools|GPU|Warning|deprecated|^\s*$/
    const trouble = []
    child.stdout.on('data', (d) => {
      String(d).split('\n').forEach((l) => {
        if (l.trim() && !noise.test(l)) log(l.replace(/\s+$/, ''))
      })
    })
    // Kept, not discarded: when a spec produces nothing this is the only
    // thing that can say why.
    child.stderr.on('data', (d) => trouble.push(String(d)))
    child.on('error', (e) => trouble.push(e.message))
    child.on('exit', (code) => {
      if (code !== 0 && trouble.length) {
        log('      the run itself failed:')
        trouble.join('').split('\n').filter((l) => l.trim()).slice(-6)
          .forEach((l) => log('        ' + l.trim()))
      }
      done(code === 0)
    })
  })
}


/**
 * Wait for the last spec's browser to actually be gone.
 *
 * Electron exiting is not the same as its windows being gone, and a spec that
 * starts while the previous one still has a visible window measures a
 * throttled, occluded page - which reports drawers at their closed position
 * and layouts mid-transition. The phone specs passed alone and failed in the
 * suite for exactly this reason, and I put it down to "contention" three
 * times before fixing it.
 */
async function browsersGone(timeoutMs = 15000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    let running = 0
    try {
      const out = execSync(
        'powershell -NoProfile -Command "(Get-Process electron -ErrorAction SilentlyContinue | Measure-Object).Count"',
        { encoding: 'utf8' }
      )
      running = Number(out.trim()) || 0
    } catch { running = 0 }
    if (running === 0) return true
    await sleep(500)
  }
  return false
}

async function main() {
  log('')
  log('  Browser tests')
  log('  ' + '-'.repeat(50))

  /*
   * Build the client people use, once, to a scratch directory.
   *
   * This built apps/client - the one that came before the React one, and
   * which nothing but the desktop app's offline fallback has loaded for
   * months. So every spec here was driving an app nobody runs: passing, in
   * detail, about a DOM that is no longer on anybody's screen. Found by
   * writing a spec for a feature that only exists in apps/web and watching it
   * fail to find a single panel.
   *
   * Never into either package's own dist: that is what a server hands out.
   */
  if (PREBUILT) {
    /*
     * A handed-in build has to be newer than the source it came from.
     *
     * UI_DIST exists so several runs can share one build instead of each
     * making its own, and it turns "rebuild first" into something a person
     * has to remember. Forgetting it is silent and looks like the app is
     * broken: the specs drive whatever was built last, fail on work that has
     * since been done, and nothing says the build is old.
     *
     * That is the same shape as the fault that started all this - a suite
     * confidently testing something nobody is running - so it is checked
     * rather than trusted.
     */
    const newest = (dir) => {
      let at = 0
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist') continue
        const full = join(dir, e.name)
        at = Math.max(at, e.isDirectory() ? newest(full) : statSync(full).mtimeMs)
      }
      return at
    }
    const builtAt = statSync(join(PREBUILT, 'index.html')).mtimeMs
    const sourceAt = newest(join(ROOT, 'apps', 'web', 'src'))
    if (sourceAt > builtAt) {
      log('  the client at UI_DIST is older than apps/web/src.')
      log('  Rebuild it, or drop UI_DIST and let this build its own:')
      log(`    cd apps/web && npx vite build --outDir ${JSON.stringify(PREBUILT)} --emptyOutDir`)
      throw new Error('the prebuilt client is out of date')
    }
    log(`  using the client already built at ${PREBUILT}`)
    mkdirSync(WORK, { recursive: true })
  } else {
  log('  building the client to a scratch directory...')
  rmSync(join(WORK, 'dist'), { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
  /*
   * Say why, when it fails.
   *
   * stdio was 'ignore', so a build failure came back as "Command failed: npx
   * vite build" and nothing else - no error, no line number, no clue whether
   * it was the code or a locked file. That happened once and cost a rerun of
   * the whole suite to find out it was neither.
   *
   * Quiet on success, because a passing build has nothing to say.
   */
  try {
    execSync(
      `npx vite build --outDir ${JSON.stringify(join(WORK, 'dist'))} --emptyOutDir`,
      { cwd: join(ROOT, 'apps', 'web'), stdio: 'pipe', encoding: 'utf8' }
    )
  } catch (err) {
    log('  the client did not build:')
    for (const part of [err.stdout, err.stderr]) {
      const text = String(part ?? '').trim()
      if (text) log(text.split('\n').map((l) => '    ' + l).join('\n'))
    }
    throw new Error('the client did not build')
  }
  }
  if (!existsSync(join(PREBUILT ?? join(WORK, 'dist'), 'index.html'))) {
    throw new Error('there is no built client to serve')
  }

  const specDir = join(HERE, 'specs')
  const specs = readdirSync(specDir)
    .filter((f) => f.endsWith('.cjs'))
    .filter((f) => !only || f.includes(only))
    .sort()

  if (!specs.length) {
    log(`  no specs match "${only}"`)
    process.exit(1)
  }

  const failed = []
  for (const file of specs) {
    const path = join(specDir, file)
    const name = file.replace(/\.cjs$/, '')
    log('')
    log(`  ${name}`)

    stopPort(PORT)
    await sleep(1200)
    let server
    try {
      server = await startServer(name)
    } catch (e) {
      log(`      FAIL could not start a server: ${e.message}`)
      failed.push(name)
      continue
    }

    const ok = await runSpec(path)
    if (!ok) failed.push(name)

    // Before the next spec opens a window of its own.
    await browsersGone()

    try { server.child.kill() } catch { /* already gone */ }
    stopPort(PORT)
    await sleep(600)
  }

  log('')
  log('  ' + '-'.repeat(50))
  if (failed.length) {
    log(`  ${failed.length} of ${specs.length} failed: ${failed.join(', ')}`)
    process.exit(1)
  }
  log(`  all ${specs.length} passed`)
  process.exit(0)
}

main().catch((e) => {
  log('  ' + (e && e.stack ? e.stack : String(e)))
  stopPort(PORT)
  process.exit(1)
})
