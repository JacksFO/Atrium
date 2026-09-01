/**
 * Cloudflare R2, spoken to directly.
 *
 * R2 offers the S3 API, and S3 wants requests signed with AWS Signature v4.
 * That is about eighty lines of hashing, which is cheaper than adding the AWS
 * SDK to a project whose scripts are otherwise pure Node - and it means the
 * backup has no dependency that can rot between the day it is written and the
 * day it is needed.
 *
 * Used by backup.mjs to put the nightly files somewhere that is not the disk
 * they are protecting.
 */
import { createHash, createHmac } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const sha256hex = (data) => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()

/**
 * Everything S3 needs to believe a request came from us.
 *
 * Exported so it can be checked against AWS's own published test vectors -
 * signing is unforgiving and fails as an opaque 403.
 */
export function signRequest({
  method, url, headers = {}, body = '', accessKeyId, secretAccessKey,
  region = 'auto', service = 's3', now,
}) {
  const u = new URL(url)
  const stamp = (now ?? new Date()).toISOString().replace(/[-:]|\.\d{3}/g, '')
  const date = stamp.slice(0, 8)

  const payloadHash = typeof body === 'string' && body === 'UNSIGNED-PAYLOAD'
    ? 'UNSIGNED-PAYLOAD'
    : sha256hex(body)

  const all = { host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp, ...headers }
  // Header names lowercased and sorted; values trimmed. S3 is strict.
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort()
  const canonicalHeaders = names.map((n) => {
    const key = Object.keys(all).find((k) => k.toLowerCase() === n)
    return `${n}:${String(all[key]).trim().replace(/\s+/g, ' ')}\n`
  }).join('')
  const signedHeaders = names.join(';')

  // Query parameters sorted by name, each encoded.
  const query = [...u.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const canonicalRequest = [
    method,
    u.pathname.split('/').map((p) => encodeURIComponent(p)).join('/'),
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${date}/${region}/${service}/aws4_request`
  const toSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256hex(canonicalRequest),
  ].join('\n')

  const signature = hmac(
    hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), 'aws4_request'),
    toSign,
  ).toString('hex')

  return {
    ...all,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

/** Reads the four settings, or null when R2 was never configured. */
export function r2Config(env = process.env) {
  const accountId = env.R2_ACCOUNT_ID ?? ''
  const accessKeyId = env.R2_ACCESS_KEY_ID ?? ''
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY ?? ''
  const bucket = env.R2_BUCKET ?? ''
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return {
    accountId, accessKeyId, secretAccessKey, bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  }
}

async function call(cfg, method, path, { body = '', headers = {}, timeoutMs = 120_000 } = {}) {
  const url = `${cfg.endpoint}/${cfg.bucket}${path}`
  const signed = signRequest({
    method, url, headers, body,
    accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey,
  })
  const res = await fetch(url, {
    method, headers: signed, body: body === '' ? undefined : body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`R2 ${method} ${path} failed: ${res.status} ${detail}`)
  }
  return res
}

/** Upload one local file. */
export async function put(cfg, key, filePath) {
  const body = readFileSync(filePath)
  /*
   * The key goes in raw.
   *
   * signRequest is the one place that encodes the path, and it does it per
   * segment. Encoding here as well turned "uploads/x.enc" into
   * "uploads%2Fx.enc", which the signer then saw as a single segment and
   * escaped again - so the path that was signed and the path that was sent
   * stopped matching, and R2 answered SignatureDoesNotMatch. Flat keys never
   * showed it, having nothing in them worth escaping.
   */
  await call(cfg, 'PUT', `/${key}`, {
    body,
    headers: { 'content-type': 'application/octet-stream', 'content-length': String(body.length) },
  })
  return body.length
}

/** Every key under a prefix, oldest first by name (names carry the timestamp). */
/**
 * Every key under a prefix, following the pages.
 *
 * S3 and R2 answer with at most a thousand keys and a token for the rest.
 * Reading only the first page was harmless while this held a couple of dozen
 * whole-folder archives, and became a silent fault the moment uploads were
 * stored one object per file: past a thousand of them the backup would stop
 * seeing what it had already sent and re-upload nightly, and a recovery would
 * quietly restore part of the bucket and report success.
 *
 * The kind of bug that only appears once there is enough in there to matter,
 * which is the same day you are least able to cope with it.
 */
export async function list(cfg, prefix = '', pageSize = 0) {
  const keys = []
  let token = null
  do {
    const query = [
      'list-type=2',
      `prefix=${encodeURIComponent(prefix)}`,
      // Only ever set by the check that proves paging works. A bucket has to
      // pass a thousand objects before the far end truncates on its own, so
      // without a way to ask for a small page this code could not be run at
      // all until the day it had to be right.
      pageSize ? `max-keys=${pageSize}` : null,
      token ? `continuation-token=${encodeURIComponent(token)}` : null,
    ].filter(Boolean).join('&')

    const res = await call(cfg, 'GET', `/?${query}`)
    const xml = await res.text()
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1])

    const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)
    token = truncated && next ? next[1] : null
  } while (token)

  return keys.sort()
}

/**
 * Download one object to a local file.
 *
 * This was missing, and its absence is the kind that only shows up on the day
 * it matters: the nightly job could put files into the bucket and list them
 * again, so everything looked complete, but nothing here could bring one
 * back. An offsite backup you have no code to fetch is a folder on somebody
 * else's computer.
 */
export async function get(cfg, key, filePath) {
  const res = await call(cfg, 'GET', `/${key}`)
  const body = Buffer.from(await res.arrayBuffer())
  writeFileSync(filePath, body)
  return body.length
}

export async function remove(cfg, key) {
  await call(cfg, 'DELETE', `/${key}`)
}
