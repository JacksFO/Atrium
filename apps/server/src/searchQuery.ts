/**
 * Pulling the filters out of what somebody typed into the search box.
 *
 * A search box takes one line, and most of what people want out of one is not
 * a word - it is "that thing Bailey posted in general last week", which is
 * three constraints and maybe no words at all. Discord spells those
 * `from:`, `in:`, `has:`, `before:` and `after:`, and enough people know that
 * spelling from elsewhere that inventing another one would only mean teaching
 * it.
 *
 * Its own file and pure, because it is a small language: what counts as a
 * filter, what happens to a half-typed one, and what is left over as words.
 * All three have a wrong answer that is easy to write and hard to notice.
 *
 * What it does *not* do is decide what any of it means. `from:bailey` comes
 * out of here as the string "bailey"; whether that is somebody, and which
 * rows it should match, belongs to the route with the database in front of
 * it. This file has no opinion about people.
 */

/** The kinds of thing a message can carry, for `has:`. */
export const HAS_KINDS = ['link', 'image', 'file', 'poll'] as const
export type HasKind = (typeof HAS_KINDS)[number]

export type SearchTerms = {
  /** What is left once the filters are taken out - the words to match on. */
  text: string
  /** A person, as typed. Not resolved to anybody here. */
  from?: string
  /** A channel, as typed, with any leading # already gone. */
  in?: string
  /** Something the message has to carry. */
  has?: HasKind
  /** Milliseconds. `before` is the start of that day, `after` is its end, so
   *  both read the way somebody means them: before the 5th excludes the 5th,
   *  and after the 5th excludes it too. */
  before?: number
  after?: number
}

/** A day, as typed. Deliberately strict: a half-typed date is not a date. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * A date at the start of its day, in the reader's own zone.
 *
 * Local rather than UTC because somebody typing a date means the day they
 * are living in. Returns null for anything that is not a real day, including
 * the ones that look like days - 2026-02-31 parses as the 3rd of March
 * everywhere if you are not careful, so what came back is checked against
 * what went in.
 */
function startOfDay(text: string): number | null {
  const m = DAY.exec(text)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const at = new Date(y, mo - 1, d, 0, 0, 0, 0)
  if (at.getFullYear() !== y || at.getMonth() !== mo - 1 || at.getDate() !== d) return null
  return at.getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The words and the filters, separated.
 *
 * A filter is a known name, a colon, and something after it. Anything else
 * that happens to contain a colon - a URL, a time, an emoticon - is left
 * alone and searched for as text, which is the behaviour that matters: the
 * common case for a colon in a message is not a filter.
 */
export function parseSearch(raw: string): SearchTerms {
  const out: SearchTerms = { text: '' }
  const words: string[] = []

  /*
   * Split on spaces, but keep a quoted run together: `in:"off topic"` is one
   * channel, and a channel with a space in its name is ordinary.
   *
   * The name before the quote is part of the same token, which is the whole
   * difference between this and matching quotes on their own - a pattern that
   * only knows about `"off topic"` splits `in:"off` off first and never sees
   * the quote at all.
   */
  const parts = raw.match(/[^\s"]*"[^"]*"|\S+/g) ?? []

  for (const part of parts) {
    const at = part.indexOf(':')
    if (at <= 0) { words.push(part); continue }

    const key = part.slice(0, at).toLowerCase()
    let value = part.slice(at + 1)
    /* A quoted value keeps its spaces and loses its quotes. */
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
      value = value.slice(1, -1)
    }

    /*
     * A filter with nothing after it is somebody mid-sentence. Dropping it
     * would make the search jump about as they typed the colon; searching for
     * the literal "from:" finds nothing at all. Left as words, so the results
     * simply do not change until they have finished typing.
     */
    if (!value) { words.push(part); continue }

    if (key === 'from') { out.from = value; continue }
    if (key === 'in') { out.in = value.replace(/^#/, ''); continue }
    if (key === 'has') {
      const kind = value.toLowerCase()
      if ((HAS_KINDS as readonly string[]).includes(kind)) {
        out.has = kind as HasKind
        continue
      }
      /* has:banana is not a filter this knows. Treated as words rather than
         as an empty result, which is the friendlier of the two wrong answers. */
      words.push(part)
      continue
    }
    if (key === 'before' || key === 'after') {
      const day = startOfDay(value)
      if (day === null) { words.push(part); continue }
      /* Both exclude the day named. Somebody asking for messages before the
         5th does not mean "and some of the 5th". */
      if (key === 'before') out.before = day
      else out.after = day + DAY_MS
      continue
    }

    words.push(part)
  }

  out.text = words.join(' ').trim()
  return out
}

/** Whether anything was asked for at all, filters included. */
export function isEmptySearch(terms: SearchTerms): boolean {
  return !terms.text && !terms.from && !terms.in && !terms.has
    && terms.before === undefined && terms.after === undefined
}
