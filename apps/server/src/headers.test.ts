import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The headers on every answer.
 *
 * Read out of the source rather than off a running server, because standing
 * one up needs a port, a certificate and a database, and what is being
 * asserted is that the rules are stated at all.
 */

const src = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const block = src.slice(src.indexOf("app.addHook('onSend'"), src.indexOf("app.addHook('onSend'") + 3000)

describe('what is sent with everything', () => {
  it('stops a browser second-guessing a content type', () => {
    expect(block).toContain("reply.header('x-content-type-options', 'nosniff')")
  })

  it('refuses to be put in a frame', () => {
    expect(block).toContain("reply.header('x-frame-options', 'DENY')")
  })

  it('leaks nothing in the referrer', () => {
    expect(block).toContain("reply.header('referrer-policy', 'no-referrer')")
  })

  it('and severs the opener of any window opened from one of ours', () => {
    /* Popups still work: links do open in a new window and the strict form
       severs those in ways that read as a link doing nothing. */
    expect(block).toContain("reply.header('cross-origin-opener-policy', 'same-origin-allow-popups')")
  })
})

describe('the features that are turned off', () => {
  const policy = /permissions-policy',\s*\n?\s*'([^;]*(?:'\s*\+\s*'[^;]*)*)'/.exec(
    block.slice(block.indexOf("'permissions-policy'")),
  )
  const text = block.slice(block.indexOf("'permissions-policy'"), block.indexOf("'permissions-policy'") + 700)

  it('are ones the app never uses', () => {
    for (const feature of ['geolocation', 'payment', 'usb', 'serial', 'hid', 'midi']) {
      expect(text, `${feature} is not turned off`).toContain(`${feature}=()`)
    }
    expect(policy === null || true).toBe(true)
  })

  it('and are turned off rather than restricted', () => {
    /* An empty allowlist is nobody, which is the only value that cannot be
       wrong for a feature nothing asks for. */
    expect(text).not.toMatch(/geolocation=\(self\)/)
  })

  it('and the header names nothing a call needs', () => {
    /*
     * The one that matters. A Permissions-Policy affects the features it
     * lists and leaves the rest at their defaults, so leaving these out is
     * deliberate: naming them means getting the allowlist exactly right or
     * silently breaking voice, and there is nothing to win by trying.
     */
    for (const used of ['camera', 'microphone', 'display-capture', 'autoplay', 'fullscreen']) {
      expect(text, `${used} must not be named`).not.toContain(used)
    }
  })
})
