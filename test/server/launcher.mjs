/*
 * The launcher, in each of the three states it can find the world in.
 *
 * It builds and runs the result; if the build fails it runs the last good
 * build and says so; if there is no build at all it falls back to the source.
 * The middle one is the interesting case - it is what stops a watchdog
 * restart at three in the morning being the thing that leaves the server
 * down - and nobody would ever exercise it by accident.
 *
 * Its own port and its own data directory. The live server is untouched.
 *
 * Each run gets its own log through ATRIUM_LOG. Windows will not let two
 * processes append to one file, and the live server holds today's - the first
 * attempt at this ran nothing at all and said so on every line.
 */
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = 'E:/FuckDiscord'
const SERVER = join(ROOT, 'apps/server')
const PORT = 8873
const BROKEN = join(SERVER, 'src/zz-deliberately-broken.ts')
const STASH = join(ROOT, 'apps/server/dist-stash-for-test')

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

const stopPort = (port) => {
  try {
    execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"`,
      { stdio: 'ignore' })
  } catch { /* nothing there */ }
}


async function run() {
  stopPort(PORT)
  const work = mkdtempSync(join(tmpdir(), 'jc-launch-'))
  const ownLog = join(work, 'launcher.log')

  const child = spawn('cmd.exe', ['/c', join(ROOT, 'scripts/run-server.cmd')], {
    env: {
      ...process.env,
      DATA_DIR: join(work, 'data'),
      UPLOAD_DIR: join(work, 'uploads'),
      PORT: String(PORT),
      TLS: 'false',
      OPEN_REGISTRATION: 'true',
      CLIENT_DIST: join(work, 'none'),
      /* Its own log: Windows will not let two processes append to one file,
         and the live server is holding today's. */
      ATRIUM_LOG: ownLog,
    },
    stdio: 'ignore',
  })

  let up = false
  const deadline = Date.now() + 70_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/members`)
      if (r.status === 200 || r.status === 401) { up = true; break }
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200))
  }

  const said = existsSync(ownLog) ? readFileSync(ownLog, 'utf8') : ''
  child.kill()
  stopPort(PORT)
  await new Promise((r) => setTimeout(r, 1500))
  rmSync(work, { recursive: true, force: true })
  return { up, said }
}

try {
  console.log('\n  --- 1. all well: build, then run the build ---')
  const clean = await run()
  check('the server comes up', clean.up === true)
  check('the log says it built', /build ok/.test(clean.said))
  check('and that it is running the built JavaScript', /running dist/.test(clean.said))

  console.log('\n  --- 2. a type error, with a good build to fall back on ---')
  writeFileSync(BROKEN, 'export const wrong: number = "this is not a number"\n')
  const broken = await run()
  check('the server still comes up', broken.up === true)
  check('and says the build failed', /BUILD FAILED/.test(broken.said))
  check('and that it is running the previous build', /PREVIOUS build/.test(broken.said))

  console.log('\n  --- 3. a type error and no build at all ---')
  cpSync(join(SERVER, 'dist'), STASH, { recursive: true })
  rmSync(join(SERVER, 'dist'), { recursive: true, force: true })
  const noDist = await run()
  check('the server still comes up', noDist.up === true)
  check('and says it fell back to the source', /no previous build/i.test(noDist.said))

  cpSync(STASH, join(SERVER, 'dist'), { recursive: true })
  rmSync(STASH, { recursive: true, force: true })
  rmSync(BROKEN, { force: true })

  console.log('\n  --- 4. and back to normal ---')
  const after = await run()
  check('it builds and runs the build again', after.up === true && /build ok/.test(after.said))
} finally {
  rmSync(BROKEN, { force: true })
  rmSync(STASH, { recursive: true, force: true })
  stopPort(PORT)
}

console.log('\n  ' + (bad === 0 ? 'the launcher comes up in every state' : bad + ' wrong'))
process.exitCode = bad === 0 ? 0 : 1
