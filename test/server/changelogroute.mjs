/**
 * The changelog route answers, and answers with real releases.
 *
 * The module underneath is unit tested against every shape GitHub sends. What
 * that cannot cover is the route itself and the one thing it depends on that
 * is not ours: that GitHub is reachable and still shaped the way it was. This
 * drives it over HTTP against a live-ish server.
 *
 * It also checks the thing that made this a server route rather than a fetch
 * from the browser: nobody has to be signed in to read a public changelog,
 * and nobody's address reaches GitHub to do it.
 */

const BASE = process.env.BASE

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

console.log('\n  --- what the releases said ---')

const first = await fetch(BASE + '/api/changelog')
const body = await first.json().catch(() => null)

check('the route answers', first.status === 200, first.status)
check('and hands back a list', Array.isArray(body?.releases), typeof body?.releases)

if (body?.unavailable) {
  /*
   * Honest rather than red: this needs the internet and a third party. A run
   * with neither should say so, not fail as though the code were wrong.
   */
  console.log('  --   GitHub was not reachable from here, so there is nothing to check')
  console.log('       (the route degraded the way it is meant to: empty list, no error)')
  check('and says so plainly rather than failing', body.releases.length === 0, body)
} else {
  const releases = body.releases
  check('with at least one release in it', releases.length > 0, releases.length)

  const one = releases[0]
  check('the newest has a version', typeof one?.version === 'string' && one.version.length > 0, one?.version)
  check('and it is a number, without the v', /^\d+\.\d+/.test(one?.version ?? ''), one?.version)
  check('and a date', !Number.isNaN(Date.parse(one?.published ?? '')), one?.published)
  check('and what it changed', typeof one?.notes === 'string' && one.notes.length > 0,
    (one?.notes ?? '').slice(0, 60))

  /* Drafts and prereleases must never appear - there have been orphan drafts
     sitting in this repository by accident, holding a hundred megabytes each. */
  check('the newest is the one people actually have',
    one.version === '0.2.24' || /^\d+\.\d+\.\d+$/.test(one.version), one.version)

  console.log('      newest: ' + one.version + '  ' + (one.published || '').slice(0, 10))
}

/*
 * Asked twice: the second must not go to GitHub again. Cannot be seen from
 * out here directly, so what is checked is that it answers the same thing
 * immediately - a fresh fetch would at minimum be slower and could differ.
 */
const started = Date.now()
const again = await fetch(BASE + '/api/changelog')
const secondBody = await again.json().catch(() => null)
const took = Date.now() - started
check('asking again is answered from memory',
  took < 250 && JSON.stringify(secondBody) === JSON.stringify(body), { ms: took })

/* A changelog is public. Requiring a token to read what changed would be
   security theatre over a page anybody can already read on GitHub. */
check('and it does not require signing in', first.status !== 401, first.status)

console.log('\n  ' + (bad === 0 ? 'the changelog is served from here, not from the browser' : bad + ' wrong'))
/*
 * The code, not an immediate exit.
 *
 * process.exit() while a keep-alive socket is still open trips a libuv
 * assertion on Windows and reports 3221226505 - a crash wearing the costume
 * of a test failure, after every check had passed. Setting the code and
 * letting the loop drain ends the same way without the theatre.
 */
process.exitCode = bad === 0 ? 0 : 1
