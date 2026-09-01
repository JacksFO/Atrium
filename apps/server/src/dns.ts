import { config } from './config.js'

/**
 * DNS providers, for the ACME DNS-01 challenge.
 *
 * DNS-01 proves you control the domain by publishing a TXT record, rather
 * than by answering an inbound HTTP request. That distinction is the whole
 * point here: the certificate can cover a name that resolves to a private
 * ZeroTier address, and nothing ever has to be exposed to the internet.
 */

export type DnsProvider = {
  name: string
  /** Publish _acme-challenge.<host> with this value. */
  setTxt(host: string, value: string): Promise<void>
  /** Remove it again once the certificate is issued. */
  clearTxt(host: string, value: string): Promise<void>
}

/* ------------------------------------------------------------ cloudflare -- */

async function cf(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.cloudflareToken}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const data = (await res.json()) as {
    success: boolean
    errors?: Array<{ message: string }>
    result: unknown
  }
  if (!data.success) {
    const detail = (data.errors ?? []).map((e: any) => e.message).join('; ')
    throw new Error(`Cloudflare API: ${detail || res.status}`)
  }
  return data.result
}

/** The zone that owns a hostname, e.g. chat.example.com -> example.com. */
async function zoneFor(hostname: string): Promise<{ id: string; name: string }> {
  const zones = (await cf('/zones?per_page=50')) as Array<{ id: string; name: string }>
  // Longest match wins, so a delegated subdomain zone beats the parent.
  const match = zones
    .filter((z) => hostname === z.name || hostname.endsWith(`.${z.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0]

  if (!match) {
    throw new Error(
      `No Cloudflare zone found for ${hostname}. The domain must be in this Cloudflare account.`
    )
  }
  return match
}

const cloudflare: DnsProvider = {
  name: 'cloudflare',

  async setTxt(host, value) {
    const zone = await zoneFor(host)
    await cf(`/zones/${zone.id}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'TXT',
        name: `_acme-challenge.${host}`,
        content: value,
        // The shortest Cloudflare allows, so a retry does not wait on a
        // stale record.
        ttl: 60,
      }),
    })
  },

  async clearTxt(host, value) {
    const zone = await zoneFor(host)
    const records = (await cf(
      `/zones/${zone.id}/dns_records?type=TXT&name=${encodeURIComponent(`_acme-challenge.${host}`)}`
    )) as Array<{ id: string; content: string }>

    for (const record of records) {
      if (record.content !== value) continue
      await cf(`/zones/${zone.id}/dns_records/${record.id}`, { method: 'DELETE' })
    }
  },
}

/* --------------------------------------------------------------- duckdns -- */

const duckdns: DnsProvider = {
  name: 'duckdns',

  async setTxt(host, value) {
    // DuckDNS holds exactly one TXT value per domain and takes the bare
    // subdomain label, not the full hostname.
    const label = host.replace(/\.duckdns\.org$/i, '')
    const url = new URL('https://www.duckdns.org/update')
    url.searchParams.set('domains', label)
    url.searchParams.set('token', config.duckdnsToken)
    url.searchParams.set('txt', value)

    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    const body = (await res.text()).trim()
    if (!body.startsWith('OK')) throw new Error(`DuckDNS refused the TXT update: ${body}`)
  },

  async clearTxt(host) {
    const label = host.replace(/\.duckdns\.org$/i, '')
    const url = new URL('https://www.duckdns.org/update')
    url.searchParams.set('domains', label)
    url.searchParams.set('token', config.duckdnsToken)
    url.searchParams.set('txt', 'removed')
    url.searchParams.set('clear', 'true')
    await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => {})
  },
}

export function dnsProvider(): DnsProvider | null {
  if (config.dnsProvider === 'cloudflare') {
    if (!config.cloudflareToken) throw new Error('CLOUDFLARE_API_TOKEN is not set')
    return cloudflare
  }
  if (config.dnsProvider === 'duckdns') {
    if (!config.duckdnsToken) throw new Error('DUCKDNS_TOKEN is not set')
    return duckdns
  }
  return null
}
