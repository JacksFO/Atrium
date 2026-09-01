import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { networkInterfaces } from 'node:os'
import selfsigned from 'selfsigned'
import { config } from './config.js'

/**
 * A self-signed certificate, generated once and reused.
 *
 * This exists for one reason: browsers only offer the microphone prompt in a
 * secure context. On plain http at a LAN address `navigator.mediaDevices` is
 * not merely blocked, it is undefined — there is nothing for anyone to allow.
 * Serving over https makes the prompt appear.
 *
 * The certificate is not signed by anyone the browser trusts, so each person
 * clicks through one warning the first time. That is the honest trade: a real
 * certificate needs a public domain, which is exactly what this setup avoids.
 */

/** Every address this machine can be reached on, so the cert covers them all. */
function localAddresses(): string[] {
  const found = new Set<string>(['127.0.0.1'])
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) found.add(iface.address)
    }
  }
  return [...found]
}

export type Tls = { key: string; cert: string }

export async function ensureCertificate(): Promise<Tls> {
  const keyPath = resolve(config.dataDir, 'server.key')
  const certPath = resolve(config.dataDir, 'server.crt')

  if (existsSync(keyPath) && existsSync(certPath)) {
    return { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') }
  }

  const ips = localAddresses()
  const attrs = [{ name: 'commonName', value: 'Atrium' }]

  // The published types describe an async form; the runtime call is
  // synchronous and returns the PEMs directly.
  // generate() really is async here. An earlier version of this cast the
  // return type to make a type error go away, which turned a compile-time
  // complaint into a runtime crash on first boot.
  // `days` is a real runtime option that the published types omit. The cast
  // is on the options only - never on the return value, which is what hid a
  // genuine bug last time.
  const options = {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true },
      {
        name: 'subjectAltName',
        // Without every reachable address listed here, a browser refuses the
        // certificate outright rather than offering the usual warning.
        altNames: [
          // 2 is a DNS name, 7 is an IP address, per the certificate spec.
          { type: 2 as const, value: 'localhost' },
          ...ips.map((ip) => ({ type: 7 as const, ip })),
        ],
      },
    ],
  } as Parameters<typeof selfsigned.generate>[1]

  const pems = await selfsigned.generate(attrs, options)

  writeFileSync(keyPath, pems.private, { mode: 0o600 })
  writeFileSync(certPath, pems.cert)

  console.log(`[tls] generated a self-signed certificate for ${ips.join(', ')}`)
  console.log('[tls] browsers will warn once; that is expected for a private server')

  return { key: pems.private, cert: pems.cert }
}
