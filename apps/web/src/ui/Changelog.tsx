import { useEffect, useState } from 'react'
import type { Api } from '../lib/api'
import { fileNotes, markNotesSeen, NOTES, noteDay, recentNotes, unseenCount } from '../lib/notes'
import { whatChanged } from '../lib/releasenotes'
import { Icon } from './Icon'

/**
 * What the last few releases changed.
 *
 * Fetched through this server rather than from GitHub directly, for the same
 * reason link previews and GIF searches are: the outbound request is made by
 * one machine on behalf of everybody, so nobody's address reaches GitHub
 * merely because they opened a settings pane.
 */

export type Release = { version: string; published: string; notes: string }

export function useChangelog(server: Api): {
  releases: Release[]
  loading: boolean
  unavailable: boolean
} {
  const [releases, setReleases] = useState<Release[]>([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let alive = true
    const mine = document.querySelector('meta[name="build"]')?.getAttribute('content') ?? ''
    void server
      .get<{ releases?: Release[]; unavailable?: boolean }>(
        `/api/changelog${mine ? `?mine=${encodeURIComponent(mine)}` : ''}`,
      )
      .then((r) => {
        if (!alive) return
        setReleases(r?.releases ?? [])
        setUnavailable(!!r?.unavailable)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        /* GitHub being unreachable is not worth an error on a settings pane.
           Nothing to show is a fine answer, and says so. */
        setUnavailable(true)
        setLoading(false)
      })
    return () => { alive = false }
  }, [server])

  return { releases, loading, unavailable }
}

const on = (published: string): string => {
  const at = Date.parse(published)
  if (!Number.isFinite(at)) return ''
  return new Date(at).toLocaleDateString(undefined, {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

/**
 * One release, as it was written.
 *
 * Taken apart into headings and points rather than printed as it arrived.
 * This drew the body as one block of text, so a note written as markdown -
 * which is what a release body is - showed its own punctuation: "## Fixed"
 * as a line beginning with two hashes, and a bulleted list as lines
 * beginning with dashes.
 *
 * whatChanged already did this, and already had tests. Nothing called it
 * from here. It handles the two shapes a body arrives in - the HTML the
 * updater converts it to, and the markdown the GitHub API hands over - so
 * both roads end up the same.
 */
/**
 * The body of a release, taken apart and drawn.
 *
 * One component, used by both the settings list and the What's New panel,
 * because there were two and only one of them parsed anything. The other
 * printed the raw body - so a release arrived on screen with `## Security`
 * and `- the app is handed to a page` written out as literal text, hashes and
 * dashes and all. Reported twice, and the second time it was this copy.
 *
 * Two places drawing the same thing two ways is the fault; one component is
 * the fix, rather than remembering to change both.
 */
export function Changes({ notes }: { notes: string }) {
  const lines = whatChanged(notes)
  if (lines.length === 0) return <p className="hint">No notes for this one.</p>
  return (
    <>
      {lines.map((line, i) => (
        line.kind === 'heading'
          ? (
            <p className="relh" key={i}>
              {/* A tag rather than a line of small capitals: a release is
                  read by skimming for the part you care about, and Security
                  ought to catch the eye differently from Added. */}
              <span className="reltag" data-kind={tagKind(line.text)}>{line.text}</span>
            </p>
          )
          : line.kind === 'item'
            ? <p className="reli" key={i}>{line.text}</p>
            : <p className="relb" key={i}>{line.text}</p>
      ))}
    </>
  )
}

/**
 * Which of the few sections this is, for the colour of its tag.
 *
 * Matched loosely on purpose: the headings are written by hand in a release
 * body, so "Security" and "Security fixes" are the same section, and anything
 * unrecognised gets the plain tag rather than no tag at all.
 */
export function tagKind(heading: string): 'security' | 'fixed' | 'added' | 'other' {
  const said = heading.toLowerCase()
  if (said.includes('secur')) return 'security'
  if (said.includes('fix')) return 'fixed'
  if (said.includes('add') || said.includes('new')) return 'added'
  return 'other'
}

export function ReleaseNotes({ release }: { release: Release }) {
  return (
    <div className="rel">
      <p className="relv">
        <b>{release.version}</b>
        {release.published && <span className="lab">{on(release.published)}</span>}
      </p>
      <Changes notes={release.notes} />
    </div>
  )
}

/**
 * The small ones, which never became a release.
 *
 * Most changes here do not move the version anybody is running — the server
 * is updated, or the client is rebuilt and served — so there is no release to
 * hang them on and they would otherwise go unsaid.
 */
export function Notes({ most }: { most?: number }) {
  const list = most ? recentNotes(most) : NOTES
  if (list.length === 0) return null
  return (
    <>
      {list.map((n, i) => (
        <p className="relnote" key={`${n.at}-${i}`}>
          <span>{n.said} <span className="lab">{noteDay(n.at)}</span></span>
        </p>
      ))}
    </>
  )
}

/** The whole list, for a settings pane. */
export function Changelog({ server, most = 12, notes }: {
  server: Api
  most?: number
  /** How many of the small ones to show above them, or none. */
  notes?: number
}) {
  const { releases, loading, unavailable } = useChangelog(server)

  const small = notes === 0 ? null : <Notes {...(notes ? { most: notes } : {})} />

  if (loading) return <>{small}<p className="hint">Reading…</p></>
  if (unavailable || releases.length === 0) {
    return (
      <>
        {small}
        <p className="hint">
          No release notes to show. They come from the project’s own releases,
          and this server could not reach them just now.
        </p>
      </>
    )
  }
  return (
    <>
      {small}
      {releases.slice(0, most).map((r) => (
        <ReleaseNotes key={r.version} release={r} />
      ))}
    </>
  )
}

/**
 * The same releases, laid across the page instead of down a column.
 *
 * Release notes are short and there are only ever a handful, so in a 268px
 * column every one of them wrapped every few words and the section read as a
 * tall grey ribbon. Side by side they read as what they are.
 *
 * The version is the thing people look for, so it is the coloured part - and
 * the newest one says so, because "which of these am I running" was
 * otherwise a question the list did not answer.
 */
export function WideChangelog({ server }: { server: Api }) {
  const { releases, loading, unavailable } = useChangelog(server)

  /*
   * How many of these arrived since they were last here.
   *
   * Read once, on the first render, and remembered as read straight after -
   * so the tags stay put for as long as the app is open rather than clearing
   * themselves out from under somebody who is still reading them, and are
   * gone the next time it opens.
   */
  const [fresh] = useState(() => unseenCount())
  /* Remembered in an effect, not in the initialiser above. React may call an
     initialiser twice, and a second call that had already written the marker
     would read its own answer and report nothing new. */
  useEffect(() => { markNotesSeen() }, [])

  /* The small changes that never became a release. Most work here does not
     move the version anybody is running, so without these the section would
     say nothing for weeks at a time. */
  /*
   * Filed against the releases, rather than "the newest six, always".
   *
   * A release ships, small changes collect after it, the next release ships
   * and that collection belongs to the version it happened under. Nothing
   * compared them before, so the same six sat under "Since" through three
   * releases in one afternoon - describing work those releases had carried
   * out to everybody days earlier.
   */
  const filed = fileNotes(releases)
  const small = filed.since.slice(0, 6)
  /* The unseen count is taken once, on mount, across every note - before the
     releases have arrived to say which of them are still waiting. So it can
     be larger than what is left in this list, and marking six rows New in a
     list of two is worse than marking none. */
  const freshHere = Math.min(fresh, small.length)

  return (
    <>
      {/*
        * The small changes, as one block rather than a drift of pills.
        *
        * Most work here never moves the version anybody is running - the
        * server is updated, or the client is rebuilt and served - so without
        * these the section would say nothing for weeks. But as loose chips
        * they wrapped at whatever width they were given and read as a pile of
        * unrelated fragments above the releases rather than as a thing.
        *
        * So they are gathered under one heading and dated once each, which is
        * what they are: everything since the last numbered release.
        */}
      {small.length > 0 && (
        <div className="wnw-since">
          <p className="wnw-since-h">
            <Icon name="chev" size={12} />
            Since {releases[0]?.version ?? 'the last release'}
            <span className="lab">
              {freshHere > 0
                ? `${freshHere} new · ${small.length} in total`
                : `${small.length} ${small.length === 1 ? 'change' : 'changes'}`}
            </span>
          </p>
          <ul className="wnw-list">
            {small.map((n, i) => (
              <li key={`${n.at}-${i}`}>
                <span>{n.said}</span>
                {/*
                  * The mark sits with the date rather than in front of the
                  * words. In front, it pushed the sentence right - so a
                  * marked row did not line up with an unmarked one - and on a
                  * row that wrapped it floated between the two lines. Here
                  * every row starts in the same place and the marks make a
                  * column of their own.
                  *
                  * The list is newest first, so the ones that arrived since
                  * they last looked are the first `fresh` of it.
                  */}
                <span className="wnw-meta">
                  {i < freshHere && <span className="wnw-new">New</span>}
                  <span className="lab">{noteDay(n.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && <p className="hint">Reading…</p>}

      {!loading && (unavailable || releases.length === 0) && (
        <p className="hint">
          No release notes to show. They come from the project’s own releases,
          and this server could not reach them just now.
        </p>
      )}

      {/*
        * Folded up, and opened one at a time.
        *
        * Laid out flat they were three boxes of clipped prose with a
        * scrollbar in each - a paragraph you can only read a third of is
        * worse than a heading you can choose to open. Closed, the list is
        * three lines and says what the versions are; open, a release shows
        * all of its notes with no scrolling inside anything.
        *
        * <details> rather than state of its own: it opens on a click, on
        * Enter, and on find-in-page, and none of that had to be written.
        */}
      {!loading && releases.length > 0 && (
        <div className="wnw-rels">
          {releases.slice(0, 5).map((r, i) => (
            <details className={i === 0 ? 'wnw-rel newest' : 'wnw-rel'} key={r.version}
              /* The newest one open, because it is the one somebody came to
                 read; the rest folded, to be chosen. `open` is the initial
                 state only - closing it stays closed. */
              {...(i === 0 ? { open: true } : {})}>
              <summary>
                <Icon name="chev" size={13} />
                <b>{r.version}</b>
                {i === 0 && <span className="wnw-now">Newest</span>}
                {r.published && <span className="lab">{on(r.published)}</span>}
              </summary>
              <div className="wnw-b">
                <Changes notes={r.notes} />
              </div>
              {/*
                * And what followed it while it was the version people were
                * running. These are the small changes that never moved a
                * version number, and this is where they end up once a newer
                * release has been cut - which is what empties the box above.
                */}
              {(filed.byVersion[r.version]?.length ?? 0) > 0 && (
                <>
                  <p className="wnw-after">And after it</p>
                  <ul className="wnw-list">
                    {filed.byVersion[r.version]!.map((n, k) => (
                      <li key={`${n.at}-${k}`}>
                        <span>{n.said}</span>
                        <span className="wnw-meta"><span className="lab">{noteDay(n.at)}</span></span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </details>
          ))}
        </div>
      )}
    </>
  )
}
