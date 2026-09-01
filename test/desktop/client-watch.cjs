/**
 * The shell notices when the server is serving a newer client.
 *
 * The client has its own check for this and it cannot cover the case that
 * matters: it ships inside the very thing that is out of date, so a window
 * running a build from before that check existed will never say a word. That
 * is not hypothetical - a desktop app and a browser ended up on different
 * builds, with a screen share between them showing nothing, and the desktop
 * only came right when it was closed and reopened.
 *
 * This drives the real endpoint the shell asks, over the real network stack,
 * and then the comparison the shell makes - rather than trusting that a
 * response with the right shape means the right decision comes out.
 */
const { app, net } = require('electron')

const SERVER = process.env.ATRIUM_TEST_SERVER || 'https://atriumapp.duckdns.org'

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

/** The shell's comparison, in the shape the shell holds it. */
function decide(state, asset) {
  if (!asset) return 'nothing to go on'
  if (!state.loaded) { state.loaded = asset; return 'first answer, so this is what we run' }
  if (asset === state.loaded) return 'same build'
  if (asset === state.offered) return 'already offered'
  state.offered = asset
  return 'offer a reload'
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  // --- the endpoint the shell actually asks ------------------------------
  let asset = null
  let status = 0
  try {
    const res = await net.fetch(`${SERVER}/api/client-version`, { cache: 'no-store' })
    status = res.status
    const body = await res.json()
    asset = body.asset ?? null
  } catch (err) {
    console.log('  could not reach the server:', String(err && err.message))
  }

  check('the version endpoint answers', status === 200, status)
  check('and names the script it is serving',
    typeof asset === 'string' && /^index-.+\.js$/.test(asset), asset)

  // --- the decision it feeds -------------------------------------------
  const state = { loaded: null, offered: null }
  check('the first answer is taken as what this window runs',
    decide(state, asset) === 'first answer, so this is what we run', state.loaded)
  check('asking again changes nothing', decide(state, asset) === 'same build')

  check('a different build offers a reload',
    decide(state, 'index-SOMETHINGELSE.js') === 'offer a reload')
  check('and does not offer the same one twice',
    decide(state, 'index-SOMETHINGELSE.js') === 'already offered')

  /*
   * A server that cannot be reached must not be read as an update. Offering a
   * reload every five minutes because the wifi dropped would be worse than
   * saying nothing at all.
   */
  check('an unreachable server says nothing', decide(state, null) === 'nothing to go on')

  // Back to the real one: still no fresh offer, because it is the build we
  // started on rather than a new one.
  check('and returning to the running build is not an update',
    decide(state, asset) === 'same build')

  console.log('\n  ' + (bad === 0 ? 'the shell can tell it is out of date' : bad + ' wrong'))
  app.quit()
  process.exit(bad === 0 ? 0 : 1)
})
