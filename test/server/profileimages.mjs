/**
 * What goes in the database is a path, and a picture has a ceiling.
 *
 * Two bugs, both found by accident while making profile pictures smaller.
 *
 * saveImage hands back a *signed* url, because that is what the uploader
 * needs to draw the picture at once. The space icon route strips the
 * signature before storing it, with a comment saying that storing it whole is
 * how the orphan sweep came to delete an icon still in use. The avatar and
 * banner routes did not - so three accounts held links with an expiry a week
 * away, and two of them had pictures that were already failing to load. The
 * sweep could not match them either, which is a file it may delete while it
 * is still on somebody's profile.
 *
 * And a picture from the GIF picker answered to no limit worth the name. A
 * file chosen off disk is shrunk in the browser, and an animated one refused
 * above 2 MB because a canvas cannot resize it without flattening it. The
 * picker skips all of that, so the easier path was the one with a 25 MB
 * ceiling: refused at 3 MB from the file picker, accepted at 20 MB from the
 * grid beside it.
 */
const BASE = process.env.BASE

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}
const call = async (path, opts = {}, token) => {
  const headers = { ...(token ? { authorization: 'Bearer ' + token } : {}) }
  if (opts.body) headers['content-type'] = 'application/json'
  const r = await fetch(BASE + path, { ...opts, headers })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const reg = async (username, invite) => {
  const b = (await call('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'password123', displayName: username, invite }),
  })).body
  return { token: b?.token, id: b?.user?.id }
}

/** The smallest thing the sniffer accepts as a PNG, padded to a given size. */
const png = (bytes) => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(Math.max(8, bytes - 8), 0x21),
])

/*
 * And a real GIF header, because the sniffer checks it.
 *
 * A first attempt sent PNG bytes labelled image/gif and got a 413 - from the
 * sniffer refusing the mismatch, not from the size limit. The right answer
 * for the wrong reason, which is worse than a failure.
 */
const gif = (bytes) => Buffer.concat([
  Buffer.from('GIF89a', 'latin1'),
  Buffer.alloc(Math.max(10, bytes - 6), 0x21),
])

const putImage = async (kind, token, body, mime = 'image/png') => {
  const r = await fetch(`${BASE}/api/me/${kind}`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': mime },
    body,
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

/* ---------------------------------------------------------------- cast -- */

const host = await reg('JacksFO')
/*
 * Made here, because signing up does not come with one.
 *
 * This read spaces[0] after registering, back when the first account claimed
 * the install and was put into a server the seed had made. Nobody claims
 * anything now and nobody is given a server - everybody makes their own - so
 * spaces[0] was undefined and every suite died on the line after it, before
 * touching what it meant to test.
 */
const space = (await call('/api/spaces', { method: 'POST', body: JSON.stringify({ name: 'Test Server' }) }, host.token)).body.space

console.log('  --- the database holds a path, not a link ---')

for (const kind of ['avatar', 'banner']) {
  const put = await putImage(kind, host.token, png(40 * 1024))
  check(`a ${kind} can be set`, put.status === 200, put.status)
  /*
   * The response carries a signed link, which is right - the uploader draws
   * it immediately and the signature is what lets them.
   */
  check(`and the answer is a signed link, which is what it is for`,
    /\?e=\d+&s=/.test(String(put.body?.url ?? '')), put.body?.url)
}

/*
 * And the stored value is not. Read back through the API rather than out of
 * the database, because what the client is handed is the thing that matters -
 * and it is hydrated from the column either way.
 */
const me = await call('/api/me', {}, host.token)
for (const column of ['avatar_path', 'banner_path']) {
  const stored = String(me.body?.user?.[column] ?? '')
  check(`the stored ${column} carries no signature`, stored !== '' && !stored.includes('?'), stored)
  check(`and no expiry to run out`, !/[?&]e=\d+/.test(stored), stored)
}

console.log('  --- a server icon, which always did this correctly ---')

const icon = await fetch(`${BASE}/api/space/icon?spaceId=${space.id}`, {
  method: 'POST',
  headers: { authorization: 'Bearer ' + host.token, 'content-type': 'image/png' },
  body: png(40 * 1024),
})
const iconBody = await icon.json().catch(() => null)
check('an icon can be set', icon.status === 200, icon.status)
check('and its stored path carries no signature either',
  !String(iconBody?.space?.icon_path ?? '').includes('?'), iconBody?.space?.icon_path)

console.log('  --- and the sweep can find what is in use ---')

/*
 * The consequence, rather than the symptom. A stored signature is a name no
 * lookup matches, so the file reads as unreferenced - which is what makes it
 * a candidate for deletion while somebody is still using it.
 */
const after = await call('/api/me', {}, host.token)
const name = String(after.body?.user?.avatar_path ?? '').split('/').pop()
check('the avatar resolves to a name a lookup can match', /^[0-9a-f-]+\.\w+$/.test(name), name)

console.log('  --- and an animated picture has a ceiling ---')

/*
 * Through the GIF picker, which is the path that had none. A real provider
 * URL cannot be fetched from a test, so this checks the two guards that come
 * first: something that is not a provider URL at all, and the shape of the
 * refusal.
 */
const notProvider = await call(`/api/me/avatar/gif`, {
  method: 'POST', body: JSON.stringify({ url: 'https://example.com/cat.gif' }),
}, host.token)
check('a picture from anywhere else is refused', notProvider.status === 400, notProvider.status)

const big = await putImage('avatar', host.token, gif(3 * 1024 * 1024), 'image/gif')
check('an animated one above the limit is refused', big.status === 413,
  { status: big.status, error: big.body?.error })
check('and the refusal says how big, and why it cannot just be shrunk',
  /MB/.test(String(big.body?.error ?? '')) && /animat/i.test(String(big.body?.error ?? '')),
  big.body?.error)

/* And one under it is fine, so the limit is a limit and not a wall. */
const small = await putImage('avatar', host.token, gif(200 * 1024), 'image/gif')
check('an animated one under the limit is kept', small.status === 200, small.status)

/* A large still picture is not refused: that one gets shrunk on the way in. */
const bigStill = await putImage('avatar', host.token, png(3 * 1024 * 1024))
check('but a large still picture is still accepted', bigStill.status === 200, bigStill.status)

console.log(bad === 0 ? '\n  a path is stored, and a picture has a ceiling' : `\n  ${bad} FAILED`)
process.exitCode = bad === 0 ? 0 : 1
