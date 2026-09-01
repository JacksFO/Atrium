/**
 * Start a server on a database of its own, then check that the servers made
 * on it are independent of one another.
 *
 * Apart from the browser suite because none of this needs a browser: it is
 * about what the API allows. Every check in independence.mjs was reported by
 * somebody who owned a server and was refused inside it, or who opened a
 * panel in their server and was shown the whole app.
 */
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const PORT = Number(process.env.PORT ?? 8862)
const WORK = join(tmpdir(), 'atrium-independence')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Stop whatever is on our port, by port.
 *
 * Never by process name: the live server is an ordinary node.exe, and a
 * by-name kill takes everybody offline.
 */
function stopPort(port) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' })
    const pids = new Set(
      out.split('\n')
        .filter((l) => l.includes(`:${port} `) && l.includes('LISTENING'))
        .map((l) => l.trim().split(/\s+/).pop())
        .filter((p) => /^\d+$/.test(p))
    )
    for (const pid of pids) {
      try { process.kill(Number(pid)) } catch { /* already gone */ }
    }
  } catch { /* no netstat here */ }
}

rmSync(WORK, { recursive: true, force: true })
mkdirSync(join(WORK, 'data'), { recursive: true })
mkdirSync(join(WORK, 'uploads'), { recursive: true })
stopPort(PORT)
await sleep(800)

const out = []
const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: join(ROOT, 'apps', 'server'),
  env: {
    ...process.env,
    DATA_DIR: join(WORK, 'data'),
    UPLOAD_DIR: join(WORK, 'uploads'),
    PORT: String(PORT),
    TLS: 'false',
    OPEN_REGISTRATION: 'true',
    // Never the live one, whatever the shell has set.
    CLIENT_DIST: join(WORK, 'none'),
    /*
     * Voice, configured with keys that go nowhere.
     *
     * Minting a token is local - it signs a JWT and hands it back - so this
     * needs no LiveKit running. Without it the route answers 503 before it
     * looks at anything, and every check behind it, including "a stranger
     * cannot join your private call", passes without being asked.
     */
    LIVEKIT_URL: 'ws://127.0.0.1:7880',
    LIVEKIT_API_KEY: 'test-key',
    LIVEKIT_API_SECRET: 'test-secret-that-is-long-enough-to-sign-with',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (d) => out.push(String(d)))
server.stderr.on('data', (d) => out.push(String(d)))

for (let i = 0; i < 45; i++) {
  try {
    // 401 is the healthy answer: it is up, and it wants a token.
    const r = await fetch(`http://localhost:${PORT}/api/members`)
    if (r.status === 401) break
  } catch { /* not listening yet */ }
  await sleep(1000)
}

/*
 * Nothing to read out of the output any more.
 *
 * This waited for a claim code and handed it to every suite, because the
 * first account had to claim the install before anybody could sign up.
 * Nobody claims anything now - people just sign up - so the only thing left
 * to establish is that the server answered, which the loop above did.
 */

/*
 * Which spec to run against the server this just started.
 *
 * There are many now - what a server lets you do, calling, attachments,
 * permissions - and they all want the same thing: a server on a database of
 * its own with nothing else on it. Starting one per suite would be the same
 * forty lines over and over.
 */
const SPEC = process.argv[2] ?? 'independence.mjs'

const child = spawn(process.execPath, [join(HERE, SPEC)], {
  /*
   * UPLOAD_DIR as well, so a spec can ask the disk whether a file is really
   * gone rather than asking the database whether it thinks so. "Deleted"
   * meaning "no longer referenced" is exactly the thing worth not assuming.
   */
  env: {
    ...process.env,
    BASE: `http://localhost:${PORT}`,
    UPLOAD_DIR: join(WORK, 'uploads'),
    /* And the database, so a spec can ask it directly what the routes did -
       which is the only way to compare two tables that are meant to agree. */
    DATA_DIR: join(WORK, 'data'),
  },
  stdio: 'inherit',
})
child.on('exit', (code) => {
  server.kill()
  stopPort(PORT)
  process.exit(code ?? 1)
})
