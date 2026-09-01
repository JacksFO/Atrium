import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { config } from './config.js'
import { saveFromUrl } from './fetchimage.js'

/**
 * The rules that apply once the server has agreed to fetch something.
 *
 * Where it is willing to go is decided elsewhere, and tested elsewhere. This
 * is about what happens next: a remote machine answering badly on purpose,
 * and a file being written to this disk on the strength of it.
 *
 * Against a real server on a real socket rather than a mocked fetch, because
 * what is being tested is the handling of a response - the length that lies,
 * the redirect, the body that is not what it says.
 */

/** The first bytes of a real GIF, which is what the sniff looks for. */
const GIF = Buffer.concat([
  Buffer.from('GIF89a', 'ascii'),
  Buffer.alloc(64, 0x21),
])

let server: Server
let origin = ''

beforeAll(async () => {
  // Somewhere of its own to write, so a test never puts anything in the
  // uploads folder of a real install.
  ;(config as { uploadDir: string }).uploadDir = mkdtempSync(join(tmpdir(), 'jc-fetch-'))

  server = createServer((req, res) => {
    const path = req.url ?? '/'
    if (path === '/good.gif') {
      res.writeHead(200, { 'content-type': 'image/gif' })
      return res.end(GIF)
    }
    if (path === '/huge.gif') {
      // Claims to be enormous, and is. Both halves are checked.
      const big = Buffer.concat([GIF, Buffer.alloc(config.maxUploadBytes + 1024, 0x21)])
      res.writeHead(200, { 'content-type': 'image/gif', 'content-length': String(big.length) })
      return res.end(big)
    }
    if (path === '/lying.gif') {
      // Says GIF, is not. The header is somebody else's claim.
      res.writeHead(200, { 'content-type': 'image/gif' })
      return res.end(Buffer.from('<!doctype html><html>not a picture at all</html>'))
    }
    if (path === '/tiny.gif') {
      res.writeHead(200, { 'content-type': 'image/gif' })
      return res.end(Buffer.from('GIF', 'ascii'))
    }
    if (path === '/moved.gif') {
      res.writeHead(302, { location: '/good.gif' })
      return res.end()
    }
    if (path === '/gone.gif') {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(500)
    res.end()
  })

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const addr = server.address()
  origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})

afterAll(() => new Promise<void>((done) => { server.close(() => done()) }))

describe('keeping our own copy of a picture', () => {
  it('fetches one and writes it here', async () => {
    const saved = await saveFromUrl(`${origin}/good.gif`)
    expect(saved.url.startsWith('/uploads/')).toBe(true)
    expect(saved.url.endsWith('.gif')).toBe(true)
    expect(saved.bytes).toBe(GIF.length)

    // On this disk, with the bytes that were served - which is the whole
    // point: the row must not point at somebody else's server.
    const onDisk = resolve(config.uploadDir, saved.url.replace('/uploads/', ''))
    expect(existsSync(onDisk)).toBe(true)
    expect(readFileSync(onDisk).equals(GIF)).toBe(true)
  })

  it('refuses one that is too large', async () => {
    await expect(saveFromUrl(`${origin}/huge.gif`)).rejects.toThrow(/too large/)
  })

  /*
   * The content-type is a claim made by whoever is answering. Believing it is
   * how a server ends up hosting somebody else's HTML under a .gif.
   */
  it('refuses something that only says it is a picture', async () => {
    await expect(saveFromUrl(`${origin}/lying.gif`)).rejects.toThrow(/not a picture/)
  })

  it('refuses one too short to have been judged', async () => {
    await expect(saveFromUrl(`${origin}/tiny.gif`)).rejects.toThrow(/not a picture/)
  })

  /*
   * Following a redirect would step around the check on where we may go: the
   * URL that was approved is not the URL that would be fetched.
   */
  it('refuses to be sent somewhere else', async () => {
    await expect(saveFromUrl(`${origin}/moved.gif`)).rejects.toThrow()
  })

  it('says so when the picture is not there', async () => {
    await expect(saveFromUrl(`${origin}/gone.gif`)).rejects.toThrow(/could not be fetched/)
  })

  it('and when nothing is listening at all', async () => {
    await expect(saveFromUrl('http://127.0.0.1:1/nothing.gif')).rejects.toThrow()
  })
})
