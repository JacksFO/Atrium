/**
 * The sound of one program, rather than all of them or none.
 *
 * Loading the compiled part is allowed to fail. It is Windows-only, it has
 * to be built for the exact Electron this is running under, and neither of
 * those is worth crashing the app over - so this reports that it is
 * unavailable and the feature simply is not offered.
 */

let native = null
let loadError = null

if (process.platform === 'win32') {
  for (const candidate of [
    '../build/Release/appaudio.node',
    '../build/Debug/appaudio.node',
    './build/Release/appaudio.node',
  ]) {
    try {
      // eslint-disable-next-line global-require
      native = require(require('path').join(__dirname, candidate))
      break
    } catch (err) {
      loadError = err
    }
  }
} else {
  loadError = new Error('capturing one program is a Windows feature')
}

/** Whether this machine can do it at all. */
function available() {
  return native !== null
}

/** Why it cannot, for saying so rather than leaving a button that does nothing. */
function unavailableBecause() {
  if (native) return null
  if (process.platform !== 'win32') return 'This only works on Windows.'
  return 'The audio capture component is not installed in this build.'
}

/**
 * Everything currently playing sound, as the volume mixer sees it.
 *
 * Returns an empty list rather than throwing when unavailable, so a caller
 * can offer a picker that is simply empty.
 */
function sessions() {
  if (!native) return []
  try {
    return native.sessions()
  } catch {
    return []
  }
}

/**
 * Start capturing one process tree.
 *
 * `onData` receives raw PCM: 48kHz, two channels, sixteen bit, little
 * endian, exactly as `format()` describes. Throws if it cannot start, with
 * a message worth showing somebody.
 */
function start(pid, onData) {
  if (!native) throw new Error(unavailableBecause())
  native.start(pid, onData)
}

function stop() {
  if (native) native.stop()
}

function running() {
  return native ? native.running() : false
}

/**
 * Which process owns a window, by handle.
 *
 * Null when the window has gone, which happens easily: a source list is a
 * moment old by the time somebody has read it.
 */
function pidForWindow(handle) {
  if (!native) return null
  try {
    return native.pidForWindow(Number(handle))
  } catch {
    return null
  }
}

/** What the bytes coming out of `start` actually are. */
function format() {
  return native ? native.format() : { sampleRate: 48000, channels: 2, bitsPerSample: 16 }
}

module.exports = {
  available, unavailableBecause, sessions, pidForWindow,
  start, stop, running, format, loadError,
}
