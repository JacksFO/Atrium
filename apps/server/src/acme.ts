import acme from 'acme-client'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Resolver } from 'node:dns/promises'
import { config } from './config.js'
import { dnsProvider } from './dns.js'
import type { Tls } from './tls.js'

/**
 * A real certificate from Let's Encrypt, via the DNS-01 challenge.
 *
 * This exists to remove the browser warning. A self-signed certificate makes
 * https work, but every person has to click through a page that says the
 * connection is not private, which is exactly the wrong thing to train your
 * friends to do.
 *
 * DNS-01 never needs an inbound connection, so the name can point at a
 * private ZeroTier address and nothing is exposed to the internet.
 */

const RENEW_BEFORE_DAYS = 30

function certPath(): string { return resolve(config.dataDir, 'letsencrypt.crt') }
function keyPath(): string { return resolve(config.dataDir, 'letsencrypt.key') }
function accountPath(): string { return resolve(config.dataDir, 'letsencrypt.account.key') }

/** Days until the stored certificate expires, or null when there is none. */
export function certificateDaysLeft(): number | null {
  if (!existsSync(certPath())) return null
  try {
    const info = acme.crypto.readCertificateInfo(readFileSync(certPath()))
    return Math.floor((info.notAfter.getTime() - Date.now()) / 86_400_000)
  } catch {
    return null
  }
}

/**
 * Every name the certificate on disk actually covers.
 *
 * Read rather than assumed, because the reason for asking is that the list
 * in the config has changed: a certificate with eighty days left on it looks
 * perfectly good to a check that only counts days, so adding a second name
 * would have been a setting that quietly did nothing until the old one
 * expired - eighty days of the new address being a security warning.
 */
export function certificateCovers(): string[] {
  if (!existsSync(certPath())) return []
  try {
    const info = acme.crypto.readCertificateInfo(readFileSync(certPath()))
    const alt = info.domains?.altNames ?? []
    const common = info.domains?.commonName
    return [...new Set([...(common ? [common] : []), ...alt])]
  } catch {
    return []
  }
}

/** Wait until the challenge TXT record is actually visible to the world. */
async function waitForTxt(host: string, value: string): Promise<void> {
  const resolver = new Resolver()
  // Ask a public resolver rather than the local one, which may cache an
  // older answer and report success before Let's Encrypt can see it.
  resolver.setServers(['1.1.1.1', '8.8.8.8'])
  const name = `_acme-challenge.${host}`

  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const records = await resolver.resolveTxt(name)
      if (records.some((parts) => parts.join('').includes(value))) return
    } catch {
      // NXDOMAIN while it propagates is expected.
    }
    await new Promise((r) => setTimeout(r, 4000))
  }
  throw new Error(
    `The DNS record ${name} did not appear within two minutes. ` +
    'Check the API token has permission to edit this zone.'
  )
}

export async function ensureTrustedCertificate(): Promise<Tls | null> {
  const provider = dnsProvider()
  if (!provider || !config.acmeDomain) return null

  const wanted = config.acmeDomains.length ? config.acmeDomains : [config.acmeDomain]
  const covers = certificateCovers()
  const missing = wanted.filter((d) => !covers.includes(d))

  const daysLeft = certificateDaysLeft()
  if (daysLeft !== null && daysLeft > RENEW_BEFORE_DAYS && missing.length === 0) {
    console.log(`[acme] certificate for ${covers.join(', ')} is valid for ${daysLeft} more days`)
    return { key: readFileSync(keyPath(), 'utf8'), cert: readFileSync(certPath(), 'utf8') }
  }
  if (missing.length) {
    console.log(`[acme] the certificate does not cover ${missing.join(', ')} - asking for a new one`)
  }

  console.log(
    daysLeft === null
      ? `[acme] requesting a certificate for ${config.acmeDomain} via ${provider.name}`
      : `[acme] certificate expires in ${daysLeft} days, renewing`
  )

  // The account key is reused, so repeated runs do not register again and
  // burn through Let's Encrypt's account rate limit.
  const accountKey = existsSync(accountPath())
    ? readFileSync(accountPath())
    : await acme.crypto.createPrivateKey()
  if (!existsSync(accountPath())) writeFileSync(accountPath(), accountKey, { mode: 0o600 })

  const client = new acme.Client({
    directoryUrl: config.acmeStaging
      ? acme.directory.letsencrypt.staging
      : acme.directory.letsencrypt.production,
    accountKey,
  })

  const [first, ...rest] = config.acmeDomains
  const [key, csr] = await acme.crypto.createCsr({
    commonName: first ?? config.acmeDomain,
    /* Absent rather than empty: an empty altNames list is a certificate
       request with an empty extension in it, which some clients reject. */
    ...(rest.length ? { altNames: rest } : {}),
  })

  try {
    const cert = await client.auto({
      csr,
      email: config.acmeEmail || undefined,
      termsOfServiceAgreed: true,
      challengePriority: ['dns-01'],

      challengeCreateFn: async (authz, challenge, keyAuthorization) => {
        if (challenge.type !== 'dns-01') throw new Error('only dns-01 is supported')
        // For dns-01 acme-client already hands us the SHA-256 digest, which
        // is exactly what goes in the TXT record. Hashing it again would
        // produce a value Let's Encrypt never matches.
        /*
         * The name being proved, not the one in the config. With more than
         * one name on the certificate there is a challenge for each, and
         * answering all of them at the first name's record proves only that
         * one - the rest fail, and the whole issuance fails with them.
         */
        const host = authz.identifier.value
        await provider.setTxt(host, keyAuthorization)
        await waitForTxt(host, keyAuthorization)
      },

      challengeRemoveFn: async (authz, challenge, keyAuthorization) => {
        if (challenge.type !== 'dns-01') return
        // Tidy-up must never fail the issuance we just completed.
        await provider.clearTxt(authz.identifier.value, keyAuthorization).catch(() => {})
      },
    })

    writeFileSync(keyPath(), key, { mode: 0o600 })
    writeFileSync(certPath(), cert)
    console.log(`[acme] certificate installed for ${wanted.join(', ')}`)
    if (config.acmeStaging) {
      console.log('[acme] this is a STAGING certificate; browsers will still warn')
    }

    return { key: key.toString(), cert: cert.toString() }
  } catch (err) {
    // Never let a failed renewal take the server down: fall back to the
    // self-signed certificate and say why.
    console.error(`[acme] could not obtain a certificate: ${err instanceof Error ? err.message : err}`)
    console.error('[acme] falling back to the self-signed certificate')
    return null
  }
}
