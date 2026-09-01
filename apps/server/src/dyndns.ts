import { config } from './config.js'

/**
 * Keep the DuckDNS record pointing at wherever this machine currently is.
 *
 * Home connections get a new address whenever the router reboots or the ISP
 * decides to move you. Without this, the name silently points somewhere else
 * one morning and nobody can connect, with nothing obviously broken to look
 * at. DuckDNS exists precisely for this.
 */

let lastSeen = ''

/** DuckDNS records whatever address the request appears to come from. */
export async function refreshDynamicDns(): Promise<void> {
  if (config.dnsProvider !== 'duckdns' || !config.duckdnsToken || !config.acmeDomain) return

  /*
   * Every name, not only the first.
   *
   * DuckDNS takes a comma-separated list and points all of them at the same
   * address. While two names are in use one of them would otherwise stop
   * being updated, and the next time this house gets a new address that name
   * would go on pointing at somebody else's - which is worse than it simply
   * not resolving.
   */
  const labels = (config.acmeDomains.length ? config.acmeDomains : [config.acmeDomain])
    .map((d) => d.replace(/\.duckdns\.org$/i, ''))
    .join(',')
  const url = new URL('https://www.duckdns.org/update')
  url.searchParams.set('domains', labels)
  url.searchParams.set('token', config.duckdnsToken)
  // An empty ip parameter tells DuckDNS to use the source address of this
  // request, which is exactly the public address we want published.
  url.searchParams.set('ip', '')

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    const body = (await res.text()).trim()
    if (!body.startsWith('OK')) {
      console.warn(`[dns] DuckDNS refused the update: ${body}`)
      return
    }

    // The response carries the address it recorded, so only log real changes
    // rather than a line every five minutes.
    const recorded = body.split('\n')[1]?.trim() ?? ''
    if (recorded && recorded !== lastSeen) {
      console.log(`[dns] ${config.acmeDomain} now points at ${recorded}`)
      lastSeen = recorded
    }
  } catch (err) {
    // Losing the internet briefly is not worth a stack trace.
    console.warn(`[dns] could not reach DuckDNS: ${err instanceof Error ? err.message : err}`)
  }
}

export function startDynamicDns(): void {
  if (config.dnsProvider !== 'duckdns' || !config.duckdnsToken) return
  void refreshDynamicDns()
  setInterval(() => void refreshDynamicDns(), 5 * 60_000).unref()
}
