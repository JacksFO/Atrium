/**
 * Build the shell, and refuse to ship one that cannot reach its own server.
 *
 * This used to be an esbuild command line in package.json, and the address
 * was passed as --define:process.env.X='\"https://...\"'. Those escaped
 * quotes are read by whichever shell npm happens to use, and cmd.exe does
 * not strip them the way sh does - so esbuild received the quotes as part of
 * the value and baked in a string with literal " characters around it.
 *
 * The result loaded nothing: the shell asked for %22https://...%22/, got
 * ERR_INVALID_URL, and fell back to the copy of the client inside the
 * installer. Every deploy went nowhere, and the app looked perfectly fine
 * while doing it - it signs in and sends messages either way.
 *
 * Going through the API means the value is a JS value until esbuild turns it
 * into one, with no shell in between. The assertion afterwards is the part
 * that matters: grepping the bundle for the hostname passed happily while
 * this bug was live, because the hostname really was in there. Only parsing
 * it as a URL catches the shape being wrong.
 */
import { build } from 'esbuild'
import { copyFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const SERVER = process.env.ATRIUM_DEFAULT_SERVER ?? 'https://atriumapp.duckdns.org'

/*
 * The version this build is, read from the package rather than typed twice.
 *
 * The preload has always offered `version` and nothing ever set it, so every
 * packaged copy of the app has answered 0.1.0 - its fallback. Nothing read it
 * until reports started carrying it, and then every report said 0.1.0, which
 * is the one field in a bug report you cannot do without.
 */
const VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version

// Fail here rather than in front of somebody who just installed the app.
try {
  const u = new URL(SERVER)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('not http(s)')
} catch (e) {
  console.error(`[build] ATRIUM_DEFAULT_SERVER is not a usable address: ${JSON.stringify(SERVER)} (${e.message})`)
  process.exit(1)
}

execFileSync(process.execPath, ['scripts/make-icon.mjs'], { stdio: 'inherit' })

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron', '../native/appaudio'],
  // JSON.stringify is what makes this a string literal rather than a guess.
  define: {
    'process.env.ATRIUM_DEFAULT_SERVER': JSON.stringify(SERVER),
    'process.env.ATRIUM_VERSION': JSON.stringify(VERSION),
  },
}

await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' })
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' })

copyFileSync('src/splash.html', 'dist/splash.html')
copyFileSync('src/offline.html', 'dist/offline.html')
/* The map of executable to game. Read at runtime rather than bundled, so it
   is a data file that can be looked at and replaced rather than 400KB of
   string wedged into the middle of the compiled main process. */
copyFileSync('src/games.json', 'dist/games.json')
copyFileSync('build/tray.png', 'dist/tray.png')
copyFileSync('build/icon.png', 'dist/icon.png')

/*
 * Read back what was actually written. A build that emits an address the
 * shell cannot parse is worse than one that emits none, because the failure
 * is invisible - it degrades into a working app running frozen code.
 */
const built = readFileSync('dist/main.cjs', 'utf8')

/** The string literal that follows a marker, read by walking it. */
function literalAfter(source, marker) {
  const at = source.indexOf(marker)
  if (at === -1) return null
  let i = at + marker.length
  if (source[i] !== '"') return null
  const start = i
  for (i += 1; i < source.length; i += 1) {
    if (source[i] === '\\') { i += 1; continue }
    if (source[i] === '"') return source.slice(start, i + 1)
  }
  return null
}

const literal = literalAfter(built, 'BUILT_FOR_SERVER = ')
if (!literal) {
  console.error('[build] the address did not reach the bundle at all')
  process.exit(1)
}
const baked = JSON.parse(literal)
try {
  new URL(baked)
} catch {
  console.error(`[build] the bundle carries an address it cannot parse: ${JSON.stringify(baked)}`)
  process.exit(1)
}
if (baked !== SERVER) {
  console.error(`[build] the bundle carries ${JSON.stringify(baked)}, not ${JSON.stringify(SERVER)}`)
  process.exit(1)
}
/*
 * And the version, checked the same way and for the same reason.
 *
 * A define that arrives with its quotes intact is the difference between
 * "0.2.37" and a string with literal quote characters in it - and the second
 * one still contains the digits, so grepping for them passes. The preload is
 * where it lands, so that is where it is read back from.
 */
const preload = readFileSync('dist/preload.cjs', 'utf8')
const said = literalAfter(preload, 'version: ')
if (!said) {
  console.error('[build] the version did not reach the preload at all')
  process.exit(1)
}
const bakedVersion = JSON.parse(said)
if (bakedVersion !== VERSION) {
  console.error(`[build] the preload says ${JSON.stringify(bakedVersion)}, not ${JSON.stringify(VERSION)}`)
  process.exit(1)
}

console.log(`[build] shell built as ${bakedVersion}, and it will look for ${baked}`)
