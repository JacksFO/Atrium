/**
 * What changed, from what the release said.
 *
 * Asked for: "when an update is pushed ... have a toast in the middle of the
 * desktop app once its open with what the update was for so they can see what
 * was fixed/added/changed."
 *
 * The text already exists and already arrives. electron-updater hands over
 * the release's own notes with the update, and the shell keeps them across
 * the restart - so nobody has to maintain a changelog file in step with the
 * releases, and nothing is fetched from anywhere to show this.
 *
 * It arrives in two shapes, and this handles both because it turned out to be
 * getting one of them wrong. electron-updater converts the release body to
 * HTML before handing it over; the GitHub API, which the Settings pane reads,
 * hands over the markdown exactly as somebody typed it. Only the HTML case was
 * understood at first, so "## Fixed" was shown as a line of text with its
 * hashes still attached and none of the sections could be told apart.
 *
 * Either way it is text written somewhere else, and it never goes near
 * innerHTML. It is taken apart here into plain lines and rendered as text.
 */

export type Line =
  /** A section: "Fixed", "Added". */
  | { kind: 'heading'; text: string }
  /** One thing that changed. */
  | { kind: 'item'; text: string }
  /** A paragraph, for notes that were not written as a list. */
  | { kind: 'text'; text: string }

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'",
}

/** The characters a release body is allowed to contain, written out. */
function unescapeText(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_whole, name: string) => {
    const known = ENTITIES[name.toLowerCase()]
    if (known !== undefined) return known
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X'
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10)
      // Anything outside the printable range is somebody being clever.
      if (Number.isFinite(code) && code >= 32 && code !== 127 && code <= 0x10ffff) {
        try { return String.fromCodePoint(code) } catch { return '' }
      }
    }
    return ''
  })
}

/**
 * The marks markdown uses for emphasis, taken off the words.
 *
 * A release body arrives as markdown, not as HTML - which is the whole reason
 * headings were coming out with their hashes still attached. Anything written
 * as **bold** or `code` would have shown its asterisks and backticks the same
 * way. Deliberately not a markdown parser: this card shows sentences, not
 * formatting, so the marks come off and nothing takes their place.
 */
function unmark(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim()
}

/** Tags out, entities in, whitespace tidied. Never markup, only words. */
function textOf(html: string): string {
  return unescapeText(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/**
 * The longest a single note may be before it is cut.
 *
 * Not a size for the card to be: the card's body scrolls, so how much there
 * is to read is the scrollbar's problem and never this function's. Set at 240
 * it was doing the card's job as well as its own, and doing it badly - a note
 * of ordinary length was stopped dead in the middle of a word, which reads as
 * the app having broken rather than as there being more to read.
 *
 * What is left is the guard this was always meant to be: a release body is
 * whatever somebody typed into a box, and one paragraph of it should not be
 * able to arrive a megabyte long. Far above anything a person writes, and the
 * server caps a whole release at four thousand characters regardless.
 */
export const MOST_LINES = 24
export const MOST_PER_LINE = 1000

/**
 * Cut, if it must be cut, between words.
 *
 * The ellipsis is a promise that something was left out. Landing it inside a
 * word instead breaks that promise: "a line above th..." reads as the app
 * having broken, where "a line above them, and..." reads as a decision.
 */
function shorten(text: string): string {
  if (text.length <= MOST_PER_LINE) return text
  const cut = text.slice(0, MOST_PER_LINE)
  const space = cut.lastIndexOf(' ')
  /* Unless there is no space anywhere near the end, in which case whatever
     this is is not prose and there is no word boundary to find. */
  return (space > MOST_PER_LINE * 0.8 ? cut.slice(0, space) : cut).trimEnd() + '…'
}

export function whatChanged(html: string | null | undefined): Line[] {
  if (!html) return []

  const lines: Line[] = []
  const push = (kind: Line['kind'], raw: string) => {
    const text = unmark(textOf(raw))
    if (!text) return
    lines.push({ kind, text: shorten(text) })
  }

  /*
   * Blocks in the order they were written, so a heading still comes before
   * the things under it. Anything that is not one of these - a table, an
   * image, a code block - falls through to the paragraph case as its words.
   */
  const blocks = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>|<li[^>]*>([\s\S]*?)<\/li>|<p[^>]*>([\s\S]*?)<\/p>/gi
  let m: RegExpExecArray | null
  let matched = false
  while ((m = blocks.exec(html)) !== null) {
    matched = true
    if (m[2] !== undefined) push('heading', m[2])
    else if (m[3] !== undefined) push('item', m[3])
    else if (m[4] !== undefined) push('text', m[4])
    if (lines.length >= MOST_LINES) break
  }

  /*
   * A release body written as plain lines, with no markup at all - which is
   * what a hand-written note looks like, and what the generic provider sends.
   */
  if (!matched) {
    for (const raw of html.split(/\r?\n/)) {
      const text = textOf(raw)
      if (!text) continue

      /*
       * "## Fixed" is a heading.
       *
       * This is what a release body actually is: the provider hands over the
       * markdown somebody typed on the release page, not HTML. So the block
       * matcher above finds nothing, every line lands here, and without this
       * a heading was shown as ordinary text with its hashes still on the
       * front - which is exactly how it looked on screen, and why the
       * sections were impossible to tell apart.
       */
      const heading = /^(#{1,6})\s+(.+)$/.exec(text)
      if (heading) {
        push('heading', heading[2]!)
        if (lines.length >= MOST_LINES) break
        continue
      }

      /* A rule between sections is a break, not a line to read. */
      if (/^([-*_])\1{2,}$/.test(text.replace(/\s+/g, ''))) continue

      // "- something" and "* something" are a list even without the tags.
      const item = /^[-*\u2022]\s+(.*)$/.exec(text)
      push(item ? 'item' : 'text', item ? item[1]! : text)
      if (lines.length >= MOST_LINES) break
    }
  }

  return lines.slice(0, MOST_LINES)
}

/**
 * Whether there is anything worth interrupting somebody for.
 *
 * A release with an empty body would otherwise put an empty card in the
 * middle of the app, which is worse than saying nothing at all.
 */
export function worthShowing(lines: Line[]): boolean {
  return lines.some((l) => l.kind === 'item' || l.kind === 'text')
}
