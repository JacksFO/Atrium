/**
 * Talking to the server.
 *
 * There is no translation layer here, and that is deliberate. The client this
 * replaces spoke a vocabulary of its own and had 1,438 lines converting
 * between it and the server's — and fourteen of the thirty bugs found in a
 * single day lived in that seam: a field read under the wrong name, a boolean
 * read as a word, an id hashed twice, a frame that was never refreshed. None
 * of them were hard bugs. They were all the same bug, which is that two
 * descriptions of one thing drift apart.
 *
 * So this speaks the server's routes and uses the server's ids. A uuid stays
 * a uuid: the old client turned every one into a small integer because it
 * read ids back out of DOM attributes with `Number()`, and React passes
 * values as values, so the reason is gone. The hashing is what made a role
 * match nothing and a whole server's members come out holding no roles.
 */


/** What the server says when it refuses. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export type Fetcher = typeof fetch

export type ApiOptions = {
  /** Where it lives. Empty for same-origin, which is the ordinary case. */
  base?: string
  /** Injected so this can be tested without a network. */
  fetch?: Fetcher
}

export class Api {
  private token = ''
  private readonly base: string
  /**
   * How a request actually goes out.
   *
   * Held as the one that was handed in, or nothing - and nothing means
   * "whatever fetch is at the moment", read when the request is made.
   *
   * It used to bind globalThis.fetch here, in the constructor, which is a
   * saving of one property read per request and makes the app impossible to
   * put anything in front of: a spec that swaps fetch to answer a request
   * without a provider key, a proxy that logs what the app asks for, a shim
   * in the desktop shell. All of them install after this object exists, and
   * none of them were ever seen.
   */
  private readonly given: Fetcher | null

  private get send(): Fetcher {
    return this.given ?? ((...args: Parameters<Fetcher>) => globalThis.fetch(...args))
  }

  constructor(opts: ApiOptions = {}) {
    this.base = opts.base ?? ''
    this.given = opts.fetch ?? null
  }

  setToken(t: string): void {
    this.token = t || ''
  }

  hasToken(): boolean {
    return this.token !== ''
  }

  /**
   * One request.
   *
   * The message on a refusal is the server's own words. A route is never put
   * in front of somebody: "Not connected yet — this goes to POST /api/polls"
   * was a note to whoever was porting it, and it ended up on a person's
   * screen. If the server has nothing to say, this says something plain
   * rather than repeating a status code at them.
   */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    /*
     * The type only where there is something to type.
     *
     * This was set on every request, body or no body, and a DELETE has no
     * body - so Fastify was handed "this is JSON" and nothing to parse, and
     * refused the request before it reached the route: "Body cannot be empty
     * when content-type is set to application/json".
     *
     * Every DELETE in the app went that way. It surfaced on the newest one
     * because that was the one somebody pressed; deleting a channel, a role
     * or an invite had the same fault waiting.
     */
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (this.token) headers.authorization = `Bearer ${this.token}`

    const res = await this.send(this.base + path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    /* A body that is not JSON is not a reason to throw something unreadable:
       a proxy in the way, or a server that fell over, answers in HTML. */
    let parsed: unknown = null
    try { parsed = await res.json() } catch { parsed = null }

    if (!res.ok) {
      const said = (parsed as { error?: unknown } | null)?.error
      throw new ApiError(
        typeof said === 'string' && said ? said : 'Something went wrong.',
        res.status,
      )
    }
    return parsed as T
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  /* A whole thing replaced rather than adjusted — which is what the channel
     permission routes take, because setting a subject's rules a permission at
     a time cannot express clearing one. */
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body)
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }

  /**
   * A file, which does not go as JSON.
   *
   * The bytes go up raw with the type in the header and the name in one of
   * its own — and what comes back is a *signed* url that must be handed on
   * exactly as given. The server takes the stored name off it itself; an
   * attachment sent under any other key, or with the signature trimmed, is
   * not refused, it is skipped. Which is how a picture went missing while the
   * message it was attached to arrived perfectly.
   */
  async upload(file: Blob, filename: string): Promise<{ url: string; bytes: number }> {
    const headers: Record<string, string> = {
      'content-type': file.type || 'application/octet-stream',
      'x-filename': encodeURIComponent(filename),
    }
    if (this.token) headers.authorization = `Bearer ${this.token}`

    const res = await this.send(`${this.base}/api/upload`, {
      method: 'POST',
      headers,
      body: file,
    })
    let parsed: unknown = null
    try { parsed = await res.json() } catch { parsed = null }
    if (!res.ok) {
      const said = (parsed as { error?: unknown } | null)?.error
      throw new ApiError(
        typeof said === 'string' && said ? said : 'That would not upload.',
        res.status,
      )
    }
    return parsed as { url: string; bytes: number }
  }

  /**
   * Bytes to a route that wants bytes, rather than JSON around them.
   *
   * The picture routes read the body as the image itself and the header as
   * its type — there is no form and no envelope. Sent as JSON they answer
   * 415, which is the same shape of mistake as sending an attachment under
   * the wrong key: refused for a reason nothing on screen would explain.
   */
  /**
   * Whether something is already there, without fetching it.
   *
   * For content named by its own hash: album art played twice, or by two
   * people, is the same file, and asking first turns nearly every upload
   * into a HEAD. False on any failure - the caller's fallback is to send it,
   * which is the safe way to be wrong.
   */
  async has(path: string): Promise<boolean> {
    try {
      const headers: Record<string, string> = {}
      if (this.token) headers.authorization = `Bearer ${this.token}`
      const res = await this.send(`${this.base}${path}`, { method: 'HEAD', headers })
      return res.ok
    } catch {
      return false
    }
  }

  /**
   * Something that is not JSON, fetched as itself.
   *
   * For the media proxy, whose whole point is that the *server* makes the
   * outbound request. An <img src> cannot carry an Authorization header, so
   * the picture is fetched here, where the token lives, and handed to the
   * tag as an object URL. The caller revokes it.
   */
  async bytes(path: string): Promise<Blob> {
    const headers: Record<string, string> = {}
    if (this.token) headers.authorization = `Bearer ${this.token}`
    const res = await this.send(`${this.base}${path}`, { method: 'GET', headers })
    if (!res.ok) throw new ApiError('That would not load.', res.status)
    return await res.blob()
  }

  async raw<T>(method: string, path: string, body: Blob, mime: string): Promise<T> {
    const headers: Record<string, string> = { 'content-type': mime }
    if (this.token) headers.authorization = `Bearer ${this.token}`

    const res = await this.send(`${this.base}${path}`, { method, headers, body })
    let parsed: unknown = null
    try { parsed = await res.json() } catch { parsed = null }
    if (!res.ok) {
      const said = (parsed as { error?: unknown } | null)?.error
      throw new ApiError(
        typeof said === 'string' && said ? said : 'That would not go.',
        res.status,
      )
    }
    return parsed as T
  }
}



