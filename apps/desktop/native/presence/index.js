/*
 * What is playing, and what is running.
 *
 * Loaded lazily and never fatally: a copy built where the native part did not
 * compile still runs, and simply has no presence to report. The app checks
 * `available` rather than assuming.
 */
let native = null
let tried = false

function load() {
  if (tried) return native
  tried = true
  try {
    native = require('./build/Release/presence.node')
  } catch {
    native = null
  }
  return native
}

module.exports = {
  get available() { return load() !== null },
  whatIsPlaying(wantArt = false) { return load() ? native.whatIsPlaying(!!wantArt) : null },
  runningNames() { return load() ? native.runningNames() : [] },
  preferApp(name) { return load() ? native.preferApp(String(name || '')) : false },
  playerApps() { return load() ? native.playerApps() : [] },

  /*
   * The same question about one process instead of all of them.
   *
   * A game runs for hours and the only thing being asked in that time is
   * whether it is still on. runningNames lists every process on the machine
   * to answer that - measured at 4.7ms, against 0.018ms for asking about one
   * known id. So the id is looked up once, when the game is first noticed,
   * and every check after it is the cheap one.
   */
  pidForName(name) { return load() ? native.pidForName(String(name)) : 0 },
  stillRunning(pid, name) {
    return load() ? native.stillRunning(Number(pid) || 0, String(name)) : false
  },
  /* The icon inside a running program's own executable, as raw pixels. Asked
     for by name, and only after that name has already been recognised. */
  iconForName(name) { return load() ? native.iconForName(String(name)) : null },

  /*
   * The same two questions, answered on a thread of their own.
   *
   * Reading a cover costs 424ms and the first icon about half a second, and
   * the app's main thread also carries the tray, the window and the global
   * shortcuts - so holding push-to-talk while a song changed could land the
   * key late, in a call. Measured at an 86ms stall warm, 17ms with these.
   */
  whatIsPlayingLater(wantArt = false) {
    return load() ? native.whatIsPlayingLater(!!wantArt) : Promise.resolve(null)
  },
  iconForNameLater(name) {
    return load() ? native.iconForNameLater(String(name)) : Promise.resolve(null)
  },

  /*
   * Being told a track changed, rather than asking every few seconds.
   *
   * Windows raises this on a thread of its own, so a track appears the moment
   * it starts instead of up to five seconds later, and the checks that used
   * to find nothing simply do not happen.
   */
  watchMedia(onChange) { return load() ? native.watchMedia(onChange) : false },
  stopWatchingMedia() { return load() ? native.stopWatchingMedia() : false },
}
