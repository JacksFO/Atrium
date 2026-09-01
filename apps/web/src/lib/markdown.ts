/**
 * What somebody wrote, as a tree rather than as HTML.
 *
 * The old renderer escaped its input and then built a string of markup around
 * it. That works right up until one hole is missed, and the rule meant to
 * catch a miss turned out not to be checking anything — an unescaped name put
 * straight into a tag walked past it for months.
 *
 * Nothing here produces markup. It produces nodes, and React puts text into
 * the document as text. There is no `esc` to forget, because there is nowhere
 * a string could be treated as HTML.
 *
 * The one thing React does not do for you is a URL: it will happily render
 * `href="javascript:..."`, so links are checked here and anything that is not
 * plainly http or https is left as the words somebody typed.
 */

export type Emphasis = 'b' | 'i' | 'u' | 's' | 'spoiler'

/**
 * A piece of a parsed message.
 *
 * Named MarkdownNode rather than Node because `Node` is a DOM global: every
 * file that imported this one had a local type quietly shadowing the browser's,
 * which is fine until somebody means the other one.
 */
export type MarkdownNode =
  | { k: 'text'; text: string }
  | { k: 'code'; text: string }
  | { k: 'pre'; text: string }
  | { k: 'link'; href: string; text: string }
  /*
   * Somebody, named as they are named now.
   *
   * `id` is who it is; `name` is only what to draw. A mention written as text
   * is the name at the moment it was typed, so it went stale the first time
   * anybody renamed themselves and stopped matching anyone at all — the @
   * turned back into a stray @ in every message that had ever addressed them.
   */
  | {
      k: 'mention'
      name: string
      me: boolean
      id?: string
      /** A whole group of people rather than one — drawn in its own colour. */
      role?: boolean
      colour?: string
    }
  | { k: 'emphasis'; style: Emphasis; kids: MarkdownNode[] }

export type Block =
  | { k: 'line'; kids: MarkdownNode[] }
  | { k: 'quote'; lines: MarkdownNode[][] }

export type RenderOptions = {
  /** Names that exist, so a stray @ stays a stray @. */
  names?: ReadonlySet<string>
  /** Yours, so your own mention can be marked. */
  me?: string
  /** Everybody who can be mentioned, by id, with the name they have today. */
  nameById?: ReadonlyMap<string, string>
  /** The same people by lowercased name, so an @name typed before this
      existed still finds who it meant and stays clickable. */
  idByName?: ReadonlyMap<string, string>
  /** Your own id, so your mentions stay yours through a rename. */
  meId?: string
  /** The roles of the server this message is in, by id. */
  roleById?: ReadonlyMap<string, { name: string; colour: string }>
  /** Which of them you hold, so a role naming you lights up. */
  myRoles?: ReadonlySet<string>
  /** Somebody may want to write :grin: and have it stay :grin:. */
  shortcodes?: boolean
  /** Shortcode to character. Passed in so this file owns no table. */
  emoji?: ReadonlyMap<string, string>
}

/**
 * A link somebody can be sent to.
 *
 * `javascript:` in an href runs when clicked, and React does not stop it —
 * this is the one place in the renderer where a value becomes something the
 * browser acts on rather than something it shows.
 */
export function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/* Longer markers first, so ** is not eaten by *. Each says what it wraps and
   whether what is inside it is parsed further — code is not, which is the
   whole point of code. */
type Marker = {
  re: RegExp
  make: (inner: string, o: RenderOptions) => MarkdownNode
}

const MARKERS: Marker[] = [
  { re: /```([\s\S]+?)```/, make: (t) => ({ k: 'pre', text: t.replace(/^\n|\n$/g, '') }) },
  { re: /`([^`\n]+?)`/, make: (t) => ({ k: 'code', text: t }) },
  { re: /\|\|([\s\S]+?)\|\|/, make: (t, o) => ({ k: 'emphasis', style: 'spoiler', kids: inline(t, o) }) },
  { re: /\*\*\*([^\n]+?)\*\*\*/, make: (t, o) => ({ k: 'emphasis', style: 'b', kids: [{ k: 'emphasis', style: 'i', kids: inline(t, o) }] }) },
  { re: /\*\*([^\n]+?)\*\*/, make: (t, o) => ({ k: 'emphasis', style: 'b', kids: inline(t, o) }) },
  { re: /(?<![\w*])\*([^\n*]+?)\*(?![\w*])/, make: (t, o) => ({ k: 'emphasis', style: 'i', kids: inline(t, o) }) },
  { re: /__([^\n]+?)__/, make: (t, o) => ({ k: 'emphasis', style: 'u', kids: inline(t, o) }) },
  { re: /~~([^\n]+?)~~/, make: (t, o) => ({ k: 'emphasis', style: 's', kids: inline(t, o) }) },
]

const LINK = /\bhttps?:\/\/[^\s<]+/
const MENTION = /@([A-Za-z0-9_.-]{2,20})/
/* What the composer writes: who was meant, not what they were called. */
const BY_ID = /<@([A-Za-z0-9_-]{1,40})>/
/* And the same for a role, which is a whole group of people at once. */
const ROLE_BY_ID = /<@&([A-Za-z0-9_-]{1,40})>/
const SHORTCODE = /:([a-z0-9_+-]{2,20}):/i

/**
 * A mention written as text, made to name a person rather than a moment.
 *
 * The typed name only finds somebody while they still answer to it, and a
 * handle does not change — so `@handle` keeps working through a rename where
 * `@Display Name` cannot. Where it does find somebody, what is drawn is the
 * name they have now, not the one that was typed: a message addressed to
 * somebody should still be addressed to them tomorrow.
 */
function mentionOf(hit: string, o: RenderOptions): MarkdownNode {
  const id = o.idByName?.get(hit.toLowerCase())
  const now = id ? o.nameById?.get(id) : undefined
  const mine = id
    ? !!o.meId && id === o.meId
    : !!o.me && hit.toLowerCase() === o.me.toLowerCase()
  return id
    ? { k: 'mention', name: now ?? hit, me: mine, id }
    : { k: 'mention', name: hit, me: mine }
}

/** Plain words: links, mentions and shortcodes, and nothing else. */
function plain(text: string, o: RenderOptions): MarkdownNode[] {
  if (!text) return []

  const link = LINK.exec(text)
  if (link && link.index !== undefined) {
    const href = safeHref(link[0])
    const node: MarkdownNode = href
      ? { k: 'link', href, text: link[0] }
      : { k: 'text', text: link[0] }
    return [
      ...plain(text.slice(0, link.index), o),
      node,
      ...plain(text.slice(link.index + link[0].length), o),
    ]
  }

  /* Before the one below, or `<@&r1>` matches as a person called "&r1". */
  const role = ROLE_BY_ID.exec(text)
  if (role && role.index !== undefined) {
    const id = role[1] ?? ''
    const named = o.roleById?.get(id)
    return [
      ...plain(text.slice(0, role.index), o),
      {
        k: 'mention',
        name: named?.name ?? 'a role',
        /* Yours when you hold it — a role mention is addressed to everybody
           who has it, and it should light up for each of them. */
        me: !!named && !!o.myRoles?.has(id),
        id,
        role: true,
        ...(named?.colour ? { colour: named.colour } : {}),
      },
      ...plain(text.slice(role.index + role[0].length), o),
    ]
  }

  const byId = BY_ID.exec(text)
  if (byId && byId.index !== undefined) {
    const id = byId[1] ?? ''
    const now = o.nameById?.get(id)
    /* Somebody this client has never heard of is still a mention — of a
       person, whose name it does not have. Better than the raw token, which
       is punctuation nobody wrote. */
    return [
      ...plain(text.slice(0, byId.index), o),
      {
        k: 'mention',
        name: now ?? 'someone',
        me: !!o.meId && id === o.meId,
        id,
      },
      ...plain(text.slice(byId.index + byId[0].length), o),
    ]
  }

  const at = MENTION.exec(text)
  if (at && at.index !== undefined && (o.names?.size || o.idByName?.size)) {
    const typed = at[1] ?? ''
    /* Only somebody who exists. A stray @ is a stray @, not a broken link.
       Their handle counts as much as their name: it is the one thing about
       them that does not change, so `@handle` is what still finds them after
       a rename — and it was never matched, because only display names were
       ever offered here. */
    let hit: string | undefined
    for (const n of o.names ?? []) if (n.toLowerCase() === typed.toLowerCase()) hit = n
    if (!hit && o.idByName?.has(typed.toLowerCase())) hit = typed
    if (hit) {
      return [
        ...plain(text.slice(0, at.index), o),
        mentionOf(hit, o),
        ...plain(text.slice(at.index + at[0].length), o),
      ]
    }
  }

  if (o.shortcodes !== false && o.emoji) {
    const code = SHORTCODE.exec(text)
    if (code && code.index !== undefined) {
      const glyph = o.emoji.get((code[1] ?? '').toLowerCase())
      if (glyph) {
        return [
          ...plain(text.slice(0, code.index), o),
          { k: 'text', text: glyph },
          ...plain(text.slice(code.index + code[0].length), o),
        ]
      }
    }
  }

  return [{ k: 'text', text }]
}

/** One line of it, as nodes. */
export function inline(text: string, o: RenderOptions = {}): MarkdownNode[] {
  if (!text) return []
  /* The earliest marker wins, so `**a** *b*` is not read as one long run. */
  let best: { at: number; m: Marker; hit: RegExpExecArray } | null = null
  for (const m of MARKERS) {
    const hit = m.re.exec(text)
    if (hit && hit.index !== undefined && (!best || hit.index < best.at)) {
      best = { at: hit.index, m, hit }
    }
  }
  if (!best) return plain(text, o)
  const { at, m, hit } = best
  return [
    ...inline(text.slice(0, at), o),
    m.make(hit[1] ?? '', o),
    ...inline(text.slice(at + hit[0].length), o),
  ]
}

/** The whole message: quoted runs, and everything else a line. */
export function render(text: string, o: RenderOptions = {}): Block[] {
  const out: Block[] = []
  let quote: MarkdownNode[][] = []
  const flush = () => {
    if (quote.length) { out.push({ k: 'quote', lines: quote }); quote = [] }
  }
  for (const line of String(text ?? '').split('\n')) {
    const q = /^>\s?(.*)$/.exec(line)
    if (q) { quote.push(inline(q[1] ?? '', o)); continue }
    flush()
    out.push({ k: 'line', kids: inline(line, o) })
  }
  flush()
  return out
}

/** Nothing but one big emoji, or three? Then they are drawn big. */
/**
 * One line of it, for a quote.
 *
 * A reply shows what it is answering above what it says, and that has to be a
 * line — so the markers go, and a code block or a picture is not drawn as
 * itself in miniature. Markers are stripped rather than parsed: what is
 * wanted is the words, and a half-open **bold in a truncated quote is not
 * worth a parse to find out about.
 */
export function oneLine(text: string, max = 120): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' code ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/\|\|([\s\S]*?)\|\|/g, 'spoiler')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

export function isJumbo(text: string): boolean {
  const s = String(text ?? '').trim()
  if (!s) return false
  const rest = s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]/gu, '')
  const count = [...s.matchAll(/\p{Extended_Pictographic}/gu)].length
  return rest === '' && count > 0 && count <= 3
}

/**
 * The links in a message, for the cards under it.
 *
 * The same pattern the renderer links with, so what gets a card and what gets
 * underlined can never disagree. Deduplicated and capped: three cards is a
 * message, ten is a wall, and somebody who pastes twenty addresses should not
 * cost twenty outbound requests.
 */
export function linksIn(text: string, max = 3): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of String(text ?? '').matchAll(/https:\/\/[^\s<>"']+/g)) {
    /* Trailing punctuation belongs to the sentence, not the address. */
    const url = m[0].replace(/[.,;:!?)\]}]+$/, '')
    if (url.length < 12 || seen.has(url)) continue
    seen.add(url)
    out.push(url)
    if (out.length === max) break
  }
  return out
}
