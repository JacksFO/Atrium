/**
 * Put this build where the live server serves from, and be able to undo it.
 *
 * The swap itself is small: the server reads its client out of a folder on
 * every request, so replacing the folder is the deploy and a browser gets the
 * new one on its next load. Nothing about the database, the accounts, the
 * servers or the messages is touched — this moves a client, and that is
 * deliberately all it does.
 *
 * What the ceremony is for is the other direction. Every step is written down
 * so that putting it back is one command rather than an archaeology exercise
 * at eleven at night, and so that nothing is overwritten before a copy of it
 * exists.
 *
 *   node deploy.mjs --check      say what would happen, change nothing
 *   node deploy.mjs              back up, swap, verify
 *   node deploy.mjs --rollback   put the previous client back
 *
 * It never restarts the server, and never builds. Both are separate decisions
 * with separate risks, and doing either silently inside a script called
 * "deploy" is how a client swap takes a chat server down with it.
 */
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const BUILT = join(HERE, 'dist')
const LIVE = join(ROOT, 'apps', 'client', 'dist')
/* Whatever was there before this build was ever deployed. Kept under its own
   name so that a second deploy does not overwrite the way back to the client
   that was live before any of this. */
const KEEP = join(ROOT, 'apps', 'client', 'dist-before-react')

const mode = process.argv.includes('--rollback') ? 'rollback'
  : process.argv.includes('--check') ? 'check' : 'deploy'

const say = (s = '') => console.log(s)
const die = (s) => { console.error(`\n  ${s}\n`); process.exit(1) }

/** What is in a folder, as one number — enough to say whether two differ. */
function fingerprint(dir) {
  if (!existsSync(dir)) return null
  const h = createHash('sha256')
  const walk = (at, rel = '') => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name)
      if (statSync(full).isDirectory()) walk(full, `${rel}${name}/`)
      else {
        h.update(`${rel}${name}`)
        h.update(readFileSync(full))
      }
    }
  }
  walk(dir)
  return h.digest('hex').slice(0, 12)
}

const count = (dir) => {
  if (!existsSync(dir)) return 0
  let n = 0
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const full = join(at, name)
      if (statSync(full).isDirectory()) walk(full)
      else n++
    }
  }
  walk(dir)
  return n
}

/* ---------------------------------------------------------- rollback ---- */

if (mode === 'rollback') {
  if (!existsSync(KEEP)) die(`there is nothing saved at ${KEEP}`)
  say(`\n  putting back what was live before this build`)
  rmSync(LIVE, { recursive: true, force: true })
  cpSync(KEEP, LIVE, { recursive: true })
  say(`  ${count(LIVE)} files, fingerprint ${fingerprint(LIVE)}`)
  say(`\n  done. A browser gets it back on its next load.\n`)
  process.exit(0)
}

/* ------------------------------------------------------------- checks --- */

if (!existsSync(BUILT)) die(`nothing is built. Run \`npx vite build\` first.`)
if (!existsSync(join(BUILT, 'index.html'))) die('the build has no index.html in it')

const page = readFileSync(join(BUILT, 'index.html'), 'utf8')

const problems = []

/*
 * The things that are worth refusing over, each of which has happened to
 * somebody: a build that names a dev server, one whose script tags point at
 * files that are not there, and one that quietly carries a source map of the
 * whole app into a public folder.
 */
if (/localhost:\d+/.test(page)) problems.push('the page names a localhost address')

for (const src of [...page.matchAll(/(?:src|href)="\/([^"]+)"/g)].map((m) => m[1])) {
  if (!existsSync(join(BUILT, src))) problems.push(`the page asks for /${src}, which is not here`)
}

for (const name of readdirSync(join(BUILT, 'assets'))) {
  if (name.endsWith('.map')) problems.push(`a source map would go too: assets/${name}`)
}

/*
 * A build has to be able to say which one it is.
 *
 * Written from the fingerprint rather than from a version number, because
 * what matters is whether the page in somebody's tab is the page on the
 * server — and two builds of the same version are two different pages.
 */
const build = fingerprint(BUILT)
writeFileSync(join(BUILT, 'version.json'), JSON.stringify({ build }) + '\n')

/*
 * And into the page, so a tab can say which build it is running.
 *
 * Written here rather than by the bundler because the number is the
 * fingerprint of the built folder, which does not exist until the bundler has
 * finished. A page that cannot name its own build compares nothing, and the
 * banner offering a reload never appears — which is a deploy that reaches
 * nobody who already has the app open.
 */
const stamped = page.includes('name="build"')
  ? page.replace(/<meta name="build" content="[^"]*">/, `<meta name="build" content="${build}">`)
  : page.replace('</head>', `  <meta name="build" content="${build}">\n  </head>`)
if (!stamped.includes(`content="${build}"`)) die('could not stamp the build into the page')
writeFileSync(join(BUILT, 'index.html'), stamped)

/*
 * And what the folder is now, which is not what it was a moment ago.
 *
 * `build` names the code; this is the whole folder including the two files
 * just written into it. Compared against the wrong one, the check after the
 * swap fails on every deploy — the copy is faithful and the number it is
 * held against is from before the stamp existed.
 */
const onDisk = fingerprint(BUILT)


say(`\n  what is live now`)
say(`  ${LIVE}`)
say(`    ${count(LIVE)} files   fingerprint ${fingerprint(LIVE) ?? 'nothing there'}`)

say(`\n  what would replace it`)
say(`  ${BUILT}`)
say(`    ${count(BUILT)} files   fingerprint ${build}`)

say(`\n  before anything moves`)
if (problems.length) {
  for (const p of problems) say(`  ✗ ${p}`)
  die('refusing to deploy that')
}
say('  · the page asks only for files that are here')
say('  · nothing names a dev server')
say('  · no source maps travel with it')
say('  · the build can say which one it is')

if (fingerprint(LIVE) === onDisk) {
  say(`\n  this is already what is live. Nothing to do.\n`)
  process.exit(0)
}

if (mode === 'check') {
  say(`\n  --check: nothing was changed.`)
  say(`  Run without it to save the current client to ${KEEP} and swap.\n`)
  process.exit(0)
}

/* -------------------------------------------------------------- swap ---- */

say(`\n  saving what is live now`)
if (existsSync(KEEP)) {
  say(`  keeping the one already saved — ${count(KEEP)} files`)
} else {
  mkdirSync(dirname(KEEP), { recursive: true })
  cpSync(LIVE, KEEP, { recursive: true })
  say(`  ${KEEP}  (${fingerprint(KEEP)})`)
}

say(`\n  swapping`)
rmSync(LIVE, { recursive: true, force: true })
cpSync(BUILT, LIVE, { recursive: true })

const after = fingerprint(LIVE)
if (after !== onDisk) die(`the swap did not land: expected ${onDisk}, found ${after}`)
say(`  ${count(LIVE)} files, fingerprint ${after}`)

say(`\n  done. Nothing about accounts, servers or messages was touched.`)
say(`  A browser gets the new client on its next load, and so does the`)
say(`  desktop app, which fetches its client from this same folder.`)
say(`\n  Still to do by hand, deliberately:`)
say(`    · check it from outside this network, not from this machine`)
say(`    · open it once yourself before telling anybody`)
say(`\n  To undo:  node apps/web/deploy.mjs --rollback\n`)
