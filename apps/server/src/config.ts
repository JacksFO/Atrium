import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')

/** Minimal .env reader — no dependency, and it only runs once at boot. */
function loadEnv(): void {
  const file = resolve(root, '.env')
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue
    process.env[key] = line.slice(eq + 1).trim()
  }
}
loadEnv()

function required(key: string): string {
  const v = process.env[key]
  if (!v || v === 'change-me-before-anyone-joins') {
    throw new Error(
      `${key} is not set. Copy .env.example to .env and set a real value.\n` +
      `Generate one with:\n  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
    )
  }
  return v
}

/**
 * A count from the environment, where a typo must not mean "no limit".
 *
 * Number('abc') is NaN and Number('') is 0, and a limit read as either of
 * those was being lifted rather than defaulted - so GIF_CALLS_PER_HOUR=90O,
 * with a letter O, silently switched off the thing it was setting. A guard
 * that fails open on a misspelling is worse than no guard, because it looks
 * set.
 *
 * Only a real number that is zero or more is honoured. Zero is kept as a
 * meaningful answer - it is how a limit is deliberately lifted - so it has to
 * be written on purpose rather than arrived at by accident.
 */
function positive(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function dir(key: string, fallback: string): string {
  const path = resolve(root, process.env[key] ?? fallback)
  mkdirSync(path, { recursive: true })
  return path
}

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 8787),
  authSecret: new TextEncoder().encode(required('AUTH_SECRET')),
  dataDir: dir('DATA_DIR', './data'),
  uploadDir: dir('UPLOAD_DIR', './uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 26_214_400),
  openRegistration: process.env.OPEN_REGISTRATION === 'true',
  /*
   * The secret that proves whoever runs Atrium, for the few routes that are
   * about the hardware rather than about anybody's server.
   *
   * Running the app is not a rank inside it. There used to be an account
   * that was both - the first person to sign up claimed the install and held
   * a role that opened the health page - which put a claim screen in front
   * of the first visitor and made hosting the thing into a position in a
   * product where nobody outranks anybody outside their own server.
   *
   * So this is a secret and not an identity: nobody signs in as the
   * operator, no account is special, and the routes it opens are not part of
   * the app people use. Unset means they do not answer at all, which is the
   * right default for an app that is simply being used.
   */
  operatorToken: (process.env.OPERATOR_TOKEN ?? '').trim(),
  // Extra browser origins allowed to call the API. localhost and private
  // network ranges are permitted automatically; this is for anything else.
  // https, so browsers will offer the microphone prompt. Uses a self-signed
  // certificate generated on first run; people click through one warning.
  tls: process.env.TLS !== 'false',

  // A real certificate from Let's Encrypt, proved over DNS so nothing is
  // ever exposed to the internet. Without this the self-signed certificate
  // is used and browsers warn once.
  acmeDomain: (process.env.ACME_DOMAIN ?? '').split(',')[0]?.trim() ?? '',
  /*
   * Every name the certificate should cover, the first being the one it is
   * issued in the name of.
   *
   * A list because an address cannot be changed in one step: everybody who
   * has the app has the old one saved, and a certificate for only the new
   * one turns every one of those into a security warning. One certificate
   * covering both means the two names are equally good while people move
   * over, and the old one comes out of the list when nobody uses it.
   */
  acmeDomains: (process.env.ACME_DOMAIN ?? '')
    .split(',').map((d) => d.trim()).filter(Boolean),
  acmeEmail: process.env.ACME_EMAIL ?? '',
  acmeStaging: process.env.ACME_STAGING === 'true',
  dnsProvider: (process.env.DNS_PROVIDER ?? '') as '' | 'cloudflare' | 'duckdns',
  cloudflareToken: process.env.CLOUDFLARE_API_TOKEN ?? '',
  duckdnsToken: process.env.DUCKDNS_TOKEN ?? '',

  // TURN, for the screen shares that cannot connect directly. Cloudflare's
  // free allowance covers a private server many times over, and a TURN
  // relay only forwards encrypted packets - it cannot read the stream.
  turnKeyId: process.env.CLOUDFLARE_TURN_KEY_ID ?? '',
  turnApiToken: process.env.CLOUDFLARE_TURN_API_TOKEN ?? '',

  /*
   * Where reports from the button in the corner are forwarded, if anywhere.
   *
   * Off unless both are set, and deliberately so: reports are written to this
   * server's own database either way, and pointing this at a repository
   * anybody can read would publish what people write about the app - and
   * sometimes about each other. A private repository, or nothing.
   */
  feedbackRepo: process.env.FEEDBACK_REPO ?? '',
  feedbackToken: process.env.FEEDBACK_TOKEN ?? '',
  // A second relay provider. Smaller free allowance, so this is a
  // fallback rather than a replacement - a browser is handed both and
  // uses whichever answers.
  meteredApiUrl: process.env.METERED_TURN_URL ?? '',

  // Voice. Point at the livekit-server process; keys must match its config.
  livekitUrl: process.env.LIVEKIT_URL ?? '',
  livekitKey: process.env.LIVEKIT_API_KEY ?? '',
  livekitSecret: process.env.LIVEKIT_API_SECRET ?? '',

  /*
   * GIF search. Whichever is set wins; KLIPY first.
   *
   * Tenor used to be here and is gone: Google stopped issuing keys in
   * January 2026 and shut the API down on 30 June 2026. Reading TENOR_API_KEY
   * would only have been a trap - a key that cannot be obtained, for a
   * service that no longer answers.
   */
  klipyKey: process.env.KLIPY_API_KEY ?? '',
  giphyKey: process.env.GIPHY_API_KEY ?? '',
  /*
   * How many provider calls an hour the picker may spend.
   *
   * A test key is a hundred, so this defaults just under it. Production
   * access - a form in the Partner Panel, granted once the integration is
   * branded and working - is unlimited, and then this stops being a
   * protection and becomes the only thing still rationing GIFs. Set it to 0
   * to lift it.
   */
  gifCallsPerHour: positive('GIF_CALLS_PER_HOUR', 90),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
} as const
