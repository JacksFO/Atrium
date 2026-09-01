/**
 * Is the presence dot actually touching the avatar in a DM profile?
 *
 * Reported with a screenshot: the dot floats off to the lower right of the
 * circle with a gap, instead of sitting on its edge the way it does in the
 * member list and on the profile card.
 *
 * Measured rather than reasoned about. The dot is placed against .av-wrap,
 * and the DM panel gives the avatar inside that wrapper a ring of its own -
 * so the drawn circle and the box the dot is positioned against are two
 * different sizes, and working out by hand which way that pushes it is
 * exactly the kind of thinking that has been wrong before.
 *
 * Loads the real stylesheets in the real order, because a copy of the rules
 * would only prove the copy right.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')
const css = ['apps/client/src/app.css', 'apps/client/src/stage1.css']
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')

const tokens = `:root{--glass:#181c22;--glass-solid:#181c22;--blur:blur(8px);--line:#2b3138;
  --line-soft:#22262c;--raise:#20252c;--raise-2:#272d35;--text:#e7ecf2;--text-dim:#9aa6b2;
  --text-faint:#6b7683;--blue:#4b8cff;--cyan:#37d5e8;--blue-ink:#04121f;--red:#e5484d;
  --grey:#6b7683;--cyan-line:#2c8f9c;--cyan-glow:0 0 8px #37d5e8;--edge-hi:none;
  --radius:12px;--radius-s:8px;--font-display:sans-serif}
  body{margin:0;background:#111}`

/*
 * The three places the same dot is drawn, so they can be compared with each
 * other rather than against a number picked out of the air. The member list
 * is the one that looks right, and is the standard the other two have to meet.
 *
 * Sizes are the ones the components really pass: 38 in a member row, 74 on
 * the profile card, 76 in the DM panel.
 */
const html = `<!doctype html><meta charset="utf-8"><style>${tokens}\n${css}</style>
<div class="mem" id="memberRow">
  <div class="av-wrap" style="width:38px;height:38px">
    <div class="av" style="width:38px;height:38px">KA</div>
    <span class="dot online"></span>
  </div>
</div>

<div class="profile-av" id="profileCard">
  <div class="av-wrap" style="width:74px;height:74px">
    <div class="av" style="width:74px;height:74px">KA</div>
    <span class="dot online"></span>
  </div>
</div>

<div class="dmp-head">
  <div class="dmp-av" id="dmPanel">
    <div class="av-wrap" style="width:76px;height:76px">
      <div class="av" style="width:76px;height:76px">KA</div>
      <span class="dot online"></span>
    </div>
  </div>
</div>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 500, height: 700 })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

  const out = await win.webContents.executeJavaScript(`(() => {
    /*
     * How far the dot's centre sits from the circle's centre, against the
     * circle's own radius. Under 1 means the dot is inside the circle; 1
     * means dead on the edge; well over 1 means it is floating away from it,
     * which is the complaint.
     *
     * Measured off the AVATAR, not off the wrapper - the avatar is what is
     * drawn, and where the two disagree is the whole bug.
     */
    const read = (id) => {
      const host = document.getElementById(id)
      const av = host.querySelector('.av')
      const dot = host.querySelector('.dot')
      const a = av.getBoundingClientRect()
      const d = dot.getBoundingClientRect()
      const cx = a.left + a.width / 2
      const cy = a.top + a.height / 2
      const dx = d.left + d.width / 2 - cx
      const dy = d.top + d.height / 2 - cy
      const radius = a.width / 2
      return {
        avatar: Math.round(a.width),
        wrapper: Math.round(host.querySelector('.av-wrap').getBoundingClientRect().width),
        dotFromCentre: Math.round(Math.hypot(dx, dy) * 10) / 10,
        radius: Math.round(radius * 10) / 10,
        howFarOut: Math.round((Math.hypot(dx, dy) / radius) * 100) / 100,
      }
    }
    return {
      member: read('memberRow'),
      profile: read('profileCard'),
      dm: read('dmPanel'),
    }
  })()`)

  console.log(JSON.stringify(out, null, 2))

  /*
   * The member row is the one that looks right, so it sets the target rather
   * than a number chosen here. Anything within a tenth of it reads as sitting
   * on the edge the same way.
   */
  const target = out.member.howFarOut
  const near = (v) => Math.abs(v - target) <= 0.1

  const results = [
    ['the member list dot sits on the edge of the circle', target <= 1.15],
    ['the profile card dot sits where the member list one does', near(out.profile.howFarOut)],
    ['the DM panel dot sits where the member list one does', near(out.dm.howFarOut)],
    // The cause, said separately: if these two disagree the dot is being
    // positioned against a box that is not the circle.
    ['and the DM panel wrapper matches the circle it draws',
      out.dm.wrapper === out.dm.avatar],
  ]

  let bad = 0
  for (const [what, ok] of results) {
    if (!ok) bad += 1
    console.log((ok ? 'PASS ' : 'FAIL ') + what)
  }
  console.log('\n  member ' + target + '  profile ' + out.profile.howFarOut
    + '  dm ' + out.dm.howFarOut + '   (1.0 = exactly on the edge)')

  app.quit()
  process.exit(bad === 0 ? 0 : 1)
})
