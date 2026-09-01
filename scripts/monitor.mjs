/**
 * How the server is doing, on a page of its own.
 *
 *   node scripts/monitor.mjs            watch atriumapp.duckdns.org
 *   node scripts/monitor.mjs --local    watch the copy on this machine
 *   node scripts/monitor.mjs --port 9000
 *
 * Storage and Server health used to be two panes inside the settings window,
 * which meant every member could see the headings for numbers that were never
 * theirs, and the app carried a whole permission tier - whose computer this
 * is - to serve an audience of one. They came out. This is where they went.
 *
 * Deliberately outside the app, and deliberately not a web page you can just
 * open. A file:// page has the origin `null`, and the server withholds the
 * CORS header for it on purpose - so a plain HTML file cannot read the API at
 * all. Rather than weaken that, this serves the page from localhost and does
 * the calls itself: the browser only ever talks to 127.0.0.1, and the token
 * never leaves this process.
 *
 * Nothing is written to disk. Sign in once, watch, close it.
 */
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { lookup } from 'node:dns/promises'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const BASE = args.includes('--local')
  ? 'https://127.0.0.1'
  : arg('--server', 'https://atriumapp.duckdns.org')
const PORT = Number(arg('--port', '8787'))
const HOST_NAME = new URL(BASE).hostname

/* The local copy answers to a certificate made out to the public name. */
if (args.includes('--local')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

/* ------------------------------------------------------------ signing in -- */

/** Ask without echoing, so a password does not end up in the scrollback. */
function secret(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const onData = (char) => {
      // Redraw the prompt without the characters typed since.
      if (!['\n', '\r', ''].includes(String(char))) {
        process.stdout.write(`\r[2K${question}`)
      }
    }
    process.stdin.on('data', onData)
    rl.question(question, (answer) => {
      process.stdin.off('data', onData)
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (a) => { rl.close(); resolve(a.trim()) })
  })
}

let token = ''

async function signIn() {
  /*
   * A prompt needs somewhere to type. Run from a script or a pipe there is
   * no terminal, readline never fires, and the process hangs on an unsettled
   * await - which says nothing about what to do instead.
   */
  if (!process.stdin.isTTY && !(process.env.JC_USER && process.env.JC_PASS)) {
    throw new Error(
      'no terminal to ask for a password on.'
      + '\n  Run this from a terminal, or set JC_USER and JC_PASS.',
    )
  }
  const username = process.env.JC_USER || await ask('username: ')
  const password = process.env.JC_PASS || await secret('password: ')
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.token) {
    throw new Error(body?.error ?? `sign in failed (${res.status})`)
  }
  token = body.token
  return body.user
}

const authed = async (path) => {
  const res = await fetch(BASE + path, { headers: { authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new Error('the session expired - restart this')
  if (res.status === 403) throw new Error('that account does not run this machine')
  if (!res.ok) throw new Error(`${path} answered ${res.status}`)
  return res.json()
}

/* ---------------------------------------------------------------- checks -- */

/** A name on this machine or this network has no public record to be wrong. */
const IS_LOCAL = /^(localhost|127\.|\[?::1\]?$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
  .test(HOST_NAME)

/**
 * Whether the name still points at this machine.
 *
 * The one that actually took the site down: a new public address, a DuckDNS
 * record still pointing at the old one, and an updater that only logs when
 * the address *changes* - so hours of failures said nothing. Comparing the
 * two is the whole check, and it is the reason this page exists rather than
 * a page of numbers nobody reads.
 */
async function dnsCheck() {
  /*
   * Only for a public name. Pointed at localhost this compared ::1 against
   * the public address and reported a red "DNS is wrong" - a false alarm on
   * the one panel whose whole job is to be believed when it says something
   * is broken.
   */
  if (IS_LOCAL) return { skipped: true }
  try {
    const [{ address: points }, real] = await Promise.all([
      lookup(HOST_NAME),
      fetch('https://api.ipify.org', { signal: AbortSignal.timeout(8000) })
        .then((r) => r.text()).then((t) => t.trim()),
    ])
    return { points, real, ok: points === real }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function snapshot() {
  const started = Date.now()
  const [health, storage, dns] = await Promise.all([
    authed('/api/admin/health'),
    authed('/api/admin/storage'),
    dnsCheck(),
  ])
  return { health, storage, dns, took: Date.now() - started, at: Date.now() }
}

/* ------------------------------------------------------------------ page -- */

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atrium — server</title>
<style>
  :root {
    --bg:#060D12; --panel:#0B151C; --line:#7FD9EE24; --raise:#FFFFFF0F;
    --text:#E8F3F7; --dim:#93AEBB; --faint:#7C929E;
    --cyan:#3FE0E8; --green:#46D6A6; --amber:#E8B45C; --red:#FF6E7F;
    --mono:'JetBrains Mono',ui-monospace,'SF Mono',Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
    font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;
    background-image:radial-gradient(1000px 500px at 20% -10%,#3FE0E814,transparent 60%)}
  .wrap{max-width:1000px;margin:0 auto;padding:26px 20px 60px}
  h1{font-size:20px;margin:0 0 3px;letter-spacing:-.01em}
  .sub{color:var(--faint);font-size:13px;margin:0 0 20px}
  .sub b{color:var(--dim);font-weight:600;font-family:var(--mono)}

  .banner{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:10px;
    border:1px solid var(--line);background:var(--raise);margin-bottom:18px;font-size:14px}
  .banner.bad{border-color:#FF6E7F55;background:#FF6E7F14;color:var(--red)}
  .banner.good{border-color:#46D6A644;background:#46D6A610}
  .dot{width:9px;height:9px;border-radius:50%;flex:none;background:var(--faint)}
  .dot.good{background:var(--green);box-shadow:0 0 10px -1px var(--green)}
  .dot.bad{background:var(--red);box-shadow:0 0 10px -1px var(--red)}

  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px;margin-bottom:22px}
  .card{border:1px solid var(--line);border-radius:11px;background:var(--panel);padding:13px 15px}
  .k{font-size:10.5px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:var(--faint)}
  .v{font-size:25px;font-weight:600;margin-top:5px;font-family:var(--mono);
    font-variant-numeric:tabular-nums;letter-spacing:-.02em}
  .v small{font-size:13px;color:var(--dim);font-weight:400;margin-left:3px}
  .n{font-size:12px;color:var(--faint);margin-top:3px}
  .v.warn{color:var(--amber)} .v.bad{color:var(--red)} .v.good{color:var(--green)}

  h2{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
    color:var(--faint);margin:26px 0 9px}
  table{width:100%;border-collapse:collapse;border:1px solid var(--line);
    border-radius:11px;overflow:hidden;background:var(--panel)}
  td{padding:9px 15px;border-bottom:1px solid #7FD9EE14;font-size:14px}
  tr:last-child td{border-bottom:0}
  td:last-child{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--dim)}
  .bar{height:7px;border-radius:99px;background:#FFFFFF17;overflow:hidden;display:flex;margin-top:9px}
  .bar i{display:block;height:100%}
  .legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:9px;font-size:12px;color:var(--faint)}
  .legend span{display:flex;align-items:center;gap:5px}
  .sw{width:9px;height:9px;border-radius:2px}
  footer{margin-top:26px;color:var(--faint);font-size:12px}
</style></head>
<body><div class="wrap">
  <h1>Atrium</h1>
  <p class="sub">watching <b id="target"></b> · refreshes every 5 seconds</p>
  <div id="alert"></div>
  <div id="body"></div>
  <footer id="foot">connecting…</footer>
</div>
<script>
const $ = (s) => document.querySelector(s)
const bytes = (n) => {
  if (n == null) return '—'
  const u = ['B','KB','MB','GB','TB']; let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return v.toFixed(v < 10 && i > 0 ? 1 : 0) + ' ' + u[i]
}
const dur = (s) => {
  const d = Math.floor(s/86400), h = Math.floor(s%86400/3600), m = Math.floor(s%3600/60)
  return d ? d+'d '+h+'h' : h ? h+'h '+m+'m' : m+'m'
}
const card = (k, v, note, cls) =>
  '<div class="card"><div class="k">'+k+'</div><div class="v '+(cls||'')+'">'+v+'</div>'
  + (note ? '<div class="n">'+note+'</div>' : '') + '</div>'
const rows = (list) => '<table>' + list.map(([a,b]) =>
  '<tr><td>'+a+'</td><td>'+b+'</td></tr>').join('') + '</table>'

async function tick() {
  let d
  try {
    const res = await fetch('/data')
    d = await res.json()
    if (d.error) throw new Error(d.error)
  } catch (err) {
    $('#alert').innerHTML =
      '<div class="banner bad"><span class="dot bad"></span>Cannot reach the server — ' + err.message + '</div>'
    $('#foot').textContent = 'last tried ' + new Date().toLocaleTimeString()
    return
  }

  const h = d.health, s = d.storage, dns = d.dns
  $('#target').textContent = d.target

  /* The check that matters most: is the name still pointing here. */
  let banner = '<div class="banner good"><span class="dot good"></span>'
    + 'Answering in ' + d.took + ' ms'
  if (dns && !dns.skipped) {
    if (dns.error) banner += ' · could not check DNS (' + dns.error + ')'
    else if (dns.ok) banner += ' · DNS points here (' + dns.points + ')'
    else banner = '<div class="banner bad"><span class="dot bad"></span>'
      + '<b>DNS is wrong.</b> The name points at ' + dns.points
      + ' but this machine is ' + dns.real + ' — nobody outside can reach it.'
  }
  $('#alert').innerHTML = banner + '</div>'

  const certDays = h.certificate?.daysLeft
  const diskPct = h.disk.total ? (1 - h.disk.free / h.disk.total) * 100 : null

  $('#body').innerHTML =
    '<div class="grid">'
    + card('Up for', dur(h.uptimeSeconds), 'since ' + new Date(h.startedAt).toLocaleString())
    + card('People online', h.realtime.people, h.realtime.sockets + ' connections')
    + card('In a call', h.realtime.inVoice,
        h.realtime.rooms + (h.realtime.rooms === 1 ? ' room' : ' rooms')
        + ' · ' + h.realtime.sharing + ' sharing · ' + h.realtime.onCamera + ' on camera')
    + card('Database', bytes(h.database.bytes),
        'answers in ' + (h.database.readMicros / 1000).toFixed(2) + ' ms',
        h.database.readMicros > 5000 ? 'warn' : '')
    + card('Disk free', bytes(h.disk.free),
        h.disk.total ? 'of ' + bytes(h.disk.total) : 'unavailable',
        diskPct != null && diskPct > 90 ? 'bad' : diskPct != null && diskPct > 75 ? 'warn' : '')
    + card('Memory', bytes(h.memory.rss), 'Node ' + h.node)
    + (certDays == null ? '' : card('Certificate', certDays + '<small>days</small>',
        'until it renews', certDays < 7 ? 'bad' : certDays < 21 ? 'warn' : 'good'))
    + '</div>'

    + '<h2>Uploads</h2>'
    + '<div class="card">'
    + '<div class="bar">'
    +   '<i style="width:' + pct(s.images, s.total) + '%;background:var(--cyan)"></i>'
    +   '<i style="width:' + pct(s.video, s.total) + '%;background:#4C8DFF"></i>'
    +   '<i style="width:' + pct(s.other, s.total) + '%;background:var(--amber)"></i>'
    +   '<i style="width:' + pct(s.database, s.total) + '%;background:#A78BFA"></i>'
    + '</div>'
    + '<div class="legend">'
    +   sw('var(--cyan)', 'Images ' + bytes(s.images))
    +   sw('#4C8DFF', 'Video ' + bytes(s.video))
    +   sw('var(--amber)', 'Other ' + bytes(s.other))
    +   sw('#A78BFA', 'Database ' + bytes(s.database))
    +   '<span style="margin-left:auto">' + bytes(s.total) + ' total · '
    +   s.files + ' files · ' + bytes(s.maxUploadBytes) + ' limit</span>'
    + '</div>'
    /* A record pointing at a file that is not there. Seven of these are the
       old orphan sweep's doing and are expected; the number changing is not,
       because nothing removes an upload now except the person who put it
       there. Shown in red only once it is worse than that. */
    + (s.missing
        ? '<div style="margin-top:8px;color:' + (s.missing > 7 ? 'var(--red)' : 'var(--dim)') + '">'
          + s.missing + ' file(s) the database points at are not on disk'
          + (s.unreferenced ? ' · ' + s.unreferenced + ' on disk that nothing points at' : '')
          + '</div>'
        : '')
    + '</div>'

    + '<h2>Contents</h2>'
    + rows([
        ['Messages', h.database.counts.messages.toLocaleString()
          + (h.database.counts.deleting ? ' (' + h.database.counts.deleting + ' being removed)' : '')],
        ['Attachments', h.database.counts.attachments.toLocaleString()],
        ['Members', h.database.counts.members.toLocaleString()],
        ['Voice', h.voiceConfigured ? 'configured' : 'not configured'],
      ])

  $('#foot').textContent = 'updated ' + new Date(d.at).toLocaleTimeString()
}
const pct = (n, total) => total ? (n / total) * 100 : 0
const sw = (colour, label) =>
  '<span><i class="sw" style="display:block;background:' + colour + '"></i>' + label + '</span>'

tick(); setInterval(tick, 5000)
</script></body></html>`

/* ------------------------------------------------------------------ main -- */

const me = await signIn().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})

/* Fail here rather than on a page full of errors. */
try {
  await authed('/api/admin/health')
} catch (err) {
  console.error(`\n  ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
}

createServer(async (req, res) => {
  if (req.url === '/data') {
    try {
      const data = await snapshot()
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ...data, target: HOST_NAME }))
    } catch (err) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    }
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(PAGE)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  signed in as ${me.username}`)
  console.log(`  watching     ${BASE}`)
  console.log(`\n  http://127.0.0.1:${PORT}\n`)
  console.log('  ctrl-c to stop\n')
})
