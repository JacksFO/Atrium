/**
 * A cover goes up once and comes back by name.
 *
 * Written because the route was broken in the one way its unit tests could
 * not see. The cache itself was covered and correct; the route around it
 * refused every upload with a 400, because image types already have a parser
 * here - the one uploads use - which hands the payload through as a stream so
 * a large file never sits in memory. The route tested for a Buffer, never
 * found one, and turned away every cover while the client dutifully tried
 * again on each track. Nothing failed; art simply never appeared.
 *
 * So this drives the route over HTTP, which is the only place that fault
 * exists.
 */

const BASE = process.env.BASE

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

const call = async (path, init = {}, token) => {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  let body = null
  try { body = await res.json() } catch { /* not json, which is fine */ }
  return { status: res.status, body }
}

const host = (await call('/api/register', {
  method: 'POST',
  body: JSON.stringify({ username: 'JacksFO', password: 'password123', displayName: 'JacksFO' }),
})).body

/* A real one-pixel PNG. Real, because the route checks the type and the hash
   and a made-up buffer would pass for the wrong reasons. */
const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' +
  '890000000a49444154789c6360000002000100055c9d5b0000000049454e44ae426082',
  'hex')
const { createHash } = await import('node:crypto')
const name = createHash('sha256').update(png).digest('hex')

const put = (hash, bytes, token, type = 'image/png') => fetch(`${BASE}/api/art/${hash}`, {
  method: 'PUT',
  headers: { 'content-type': type, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: bytes,
})

console.log('\n  --- a cover, by the name of its own bytes ---')

const before = await fetch(`${BASE}/api/art/${name}`, { method: 'HEAD' })
check('it is not there to begin with', before.status === 404, before.status)

const sent = await put(name, png, host.token)
check('it can be put there', sent.status === 200, sent.status)

const known = await fetch(`${BASE}/api/art/${name}`, { method: 'HEAD' })
check('and the client can tell it is already there', known.status === 200, known.status)

const got = await fetch(`${BASE}/api/art/${name}`)
const back = Buffer.from(await got.arrayBuffer())
check('it comes back', got.status === 200, got.status)
check('as the same bytes that went up', back.equals(png), { sent: png.length, back: back.length })
check('and says what kind of picture it is',
  got.headers.get('content-type') === 'image/png', got.headers.get('content-type'))
/* The address is the content, so it can never be the wrong picture and a
   browser need never ask twice. */
check('and that it never needs asking for again',
  /immutable/.test(got.headers.get('cache-control') ?? ''), got.headers.get('cache-control'))

console.log('\n  --- and what it will not take ---')

/*
 * The whole of the safety. The only thing anybody can store under a name is
 * the thing that hashes to it, so one person cannot put a picture where
 * another person's is meant to be.
 */
const wrong = await put(createHash('sha256').update('something else').digest('hex'), png, host.token)
check('bytes that are not the ones the name is for', wrong.status === 400, wrong.status)

const notAName = await put('../../etc/passwd', png, host.token)
check('a name that is not a hash', notAName.status !== 200, notAName.status)

/*
 * Refused, though not by this route: Fastify turns away a content type
 * nothing has a parser for, with a 415, before the handler is reached. Which
 * is the better answer - so what is asserted is that it does not get in, not
 * which layer says no.
 */
const notAPicture = await put(
  createHash('sha256').update('<script>').digest('hex'), Buffer.from('<script>'), host.token, 'text/html')
check('something that is not a picture', notAPicture.status !== 200, notAPicture.status)

const huge = Buffer.alloc(40 * 1024, 7)
const tooBig = await put(createHash('sha256').update(huge).digest('hex'), huge, host.token)
check('and one too big to be a thumbnail', tooBig.status === 400, tooBig.status)

const anonymous = await put(name, png, null)
check('nor from somebody who is not signed in', anonymous.status === 401, anonymous.status)

console.log('\n  ' + (bad === 0 ? 'covers travel once, by name' : bad + ' wrong'))
process.exit(bad === 0 ? 0 : 1)
