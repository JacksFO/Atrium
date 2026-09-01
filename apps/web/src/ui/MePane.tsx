import { Picker } from './Picker'
import { toast } from '../lib/toast'
import { statusUntil, STATUS_FOR } from '../lib/status'
import { useEffect, useRef, useState } from 'react'
import type { Api } from '../lib/api'
import type { User } from '../lib/wire'
import { Avatar } from './Avatar'
import { GifPicker } from './GifPicker'
import type { Gif } from '../lib/gifs'
import type { Anchor } from './useAnchored'
import {
  shrinkForUpload, AVATAR_EDGE, BANNER_EDGE, PROFILE_SMALL_ENOUGH,
} from '../lib/shrinkimage'
import { NAME_COLOURS, nameLook } from '../lib/nameStyle'
import type { NameEffect, NameFont } from '../lib/wire'

/**
 * Your own profile.
 *
 * The one pane that was missing entirely: the settings screen could change
 * how the app looked and nothing about the person using it — no name, no
 * picture, no status, no colour. Everything here already existed on the
 * server and in the profile card that draws it; there was simply nothing to
 * set it with.
 */
export function MePane({ server, me, onSaved }: {
  server: Api
  me: User
  /** The row that came back, so the rest of the app stops showing the old one. */
  onSaved: (user: User) => void
}) {
  const [name, setName] = useState(me.display_name || me.username)
  const [status, setStatus] = useState(me.status_text ?? '')
  /*
   * How long a status set now should stand for.
   *
   * The choice, not the moment: showing "1 hour" for one set fifty minutes
   * ago would be a lie by the time anybody read it, and the honest version
   * would be a countdown nobody asked for. Whatever is chosen here is counted
   * from the save, which is when it starts being true.
   */
  const [clearAfter, setClearAfter] = useState(0)
  const [bio, setBio] = useState(me.bio ?? '')
  const [accent, setAccent] = useState(me.accent || '#3FE0E8')
  /* The second colour, which only the effects that fill the letters use. */
  const [accent2, setAccent2] = useState(me.accent_2 || '#9B8CFF')
  const [said, setSaid] = useState('')
  /* Drawn from what is on screen rather than from what has been saved, so the
     preview answers a change before the server has. */
  const look = nameLook({
    accent, accent_2: accent2,
    name_font: me.name_font, name_effect: me.name_effect,
  })
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const which = useRef<'avatar' | 'banner'>('avatar')
  /**
   * Choosing one from the grid rather than off disk.
   *
   * The picker was already here for messages and a GIF was already accepted
   * as an avatar. What was missing was the two being introduced.
   */
  const [gifs, setGifs] = useState<Anchor | null>(null)

  /*
   * The animated one, not the video.
   *
   * A message prefers the mp4 - far cheaper to play, and a message is drawn
   * once. An avatar is drawn beside every line somebody says, where there is
   * no player to put a video in, so it is the picture that is wanted here.
   */
  const wearGif = async (g: Gif) => {
    setGifs(null)
    setBusy(true)
    setSaid('')
    try {
      await server.post(`/api/me/${which.current}/gif`, { url: g.preview || g.still })
      const r = await server.get<{ user?: User }>('/api/me')
      if (r?.user) onSaved(r.user)
      setSaid('Saved.')
    } catch (e) {
      setSaid(e instanceof Error ? e.message : 'That one would not save.')
    } finally {
      setBusy(false)
    }
  }

  /* Where the grid is drawn from, in the window's own coordinates - it is
     portalled onto the window, and a settings pane that scrolls would
     otherwise anchor it off the top. */
  const openGifs = (kind: 'avatar' | 'banner', e: { currentTarget: HTMLElement }) => {
    which.current = kind
    const r = e.currentTarget.getBoundingClientRect()
    setGifs({ x: r.left + r.width, y: r.top, w: r.width, h: r.height })
  }

  const save = (body: Record<string, unknown>) => {
    void server.patch<{ user?: User; error?: string }>('/api/me', body)
      .then((r) => {
        if (r?.user) onSaved(r.user)
        /* Said over the app rather than at the foot of the pane: a save is
           worth confirming and not worth reading twice, and a line down there
           was as easy to miss as the silence it replaced. */
        setSaid('')
        toast('Your changes have been saved')
      })
      .catch((e: unknown) => setSaid(e instanceof Error ? e.message : 'That would not save.'))
  }

  /*
   * The same, for something being dragged.
   *
   * A colour input fires while the pointer moves, and every one of these was
   * a request. Measured in the live log: picking one colour sent 241 saves in
   * a minute, 106 of them inside a single second - and each is a row written
   * AND a member-update pushed to everybody who can see you, so the cost lands
   * on the whole server rather than on the person choosing.
   *
   * The preview still follows the pointer, because that reads from what is on
   * screen rather than from what has been saved. Only the server hears less.
   */
  const later = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsaved = useRef<Record<string, unknown> | null>(null)

  const saveSoon = (body: Record<string, unknown>) => {
    unsaved.current = body
    if (later.current) clearTimeout(later.current)
    later.current = setTimeout(() => {
      later.current = null
      const held = unsaved.current
      unsaved.current = null
      if (held) save(held)
    }, 400)
  }

  /* Closing the panel mid-drag must not lose the colour somebody just chose.
     The timer goes; whatever it was holding is sent now. */
  useEffect(() => () => {
    if (!later.current) return
    clearTimeout(later.current)
    const held = unsaved.current
    unsaved.current = null
    if (held) {
      void server.patch<{ user?: User; error?: string }>('/api/me', held).catch(() => {
        /* On the way out, with nothing left to tell. */
      })
    }
  }, [server])

  /*
   * The picture routes take the bytes and a content-type, not JSON and not a
   * form — so the file goes up as itself.
   *
   * It used to go up at whatever size it was chosen at, and this comment used
   * to say so approvingly. What that meant in practice: six people's pictures
   * weighed 6.1MB between them, one banner alone 4.7MB, and every one of them
   * is fetched by everybody who opens the app - to be drawn as a forty-pixel
   * circle beside a name. The sizes to draw them at were already written down
   * and already tested; nothing had ever passed them to anything.
   *
   * An animated picture is left exactly as it was: a canvas draws one frame,
   * so shrinking a GIF would turn an animation into a photograph of its first
   * moment. couldShrink refuses them, and so this quietly does nothing to
   * them, which is the right nothing.
   */
  const upload = async (file: File) => {
    setBusy(true)
    setSaid('')
    try {
      const edge = which.current === 'avatar' ? AVATAR_EDGE : BANNER_EDGE
      const sending = await shrinkForUpload(file, {
        edge, smallEnough: PROFILE_SMALL_ENOUGH,
      })
      const r = await server.raw<{ user?: User; error?: string }>(
        'POST', `/api/me/${which.current}`, sending, sending.type,
      )
      if (r?.user) onSaved(r.user)
      setSaid('Saved.')
    } catch (e) {
      setSaid(e instanceof Error ? e.message : 'That would not upload.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="card">
        <h4>You</h4>

        <div className="row">
          <span className="txt">
            <span className="t">Picture</span>
            <span className="d">Shown beside everything you say.</span>
          </span>
          {/* Grouped, so they wrap together. Four separate items on a row
              this narrow put the last of them off the side of a phone. */}
          <span className="rowacts">
            <Avatar user={me} size="lg" />
            <button className="btn" disabled={busy} onClick={() => {
              which.current = 'avatar'
              picker.current?.click()
            }}>Change</button>
            <button className="btn" disabled={busy}
              onClick={(e) => openGifs('avatar', e)}>GIF</button>
            {me.avatar_path && (
              <button className="btn d" disabled={busy}
                onClick={() => save({ avatarPath: null })}>Clear</button>
            )}
          </span>
        </div>

        <div className="row">
          <span className="txt">
            <span className="t">Banner</span>
            <span className="d">The strip behind your name on your card.</span>
          </span>
          <span className="rowacts">
            <button className="btn" disabled={busy} onClick={() => {
              which.current = 'banner'
              picker.current?.click()
            }}>Change</button>
            <button className="btn" disabled={busy}
              onClick={(e) => openGifs('banner', e)}>GIF</button>
            {me.banner_path && (
              <button className="btn d" disabled={busy}
                onClick={() => save({ bannerPath: null })}>Clear</button>
            )}
          </span>
        </div>

        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void upload(f)
            /* Cleared, or choosing the same file twice in a row does nothing
               the second time — the input's value has not changed. */
            e.target.value = ''
          }}
        />

        <div className="fld">
          <label>Name</label>
          <input value={name} aria-label="Your name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== me.display_name && save({ display_name: name })} />
        </div>

        <div className="fld">
          <label>Status</label>
          <input value={status} aria-label="What you are up to"
            placeholder="What you are up to"
            onChange={(e) => setStatus(e.target.value)}
            onBlur={() => status !== (me.status_text ?? '')
              && save({ status_text: status, status_until: statusUntil(clearAfter) })} />
          {/*
            * How long it stands for.
            *
            * Saved with the status rather than on its own, so a moment can
            * never outlive the words it was set for - and it is only worth
            * offering while there is something to clear.
            */}
          {status.trim() !== '' && (
            <div className="statuswhen">
              <span className="lbl">Clear after</span>
              <Picker
                label="Clear the status after"
                value={clearAfter}
                options={STATUS_FOR.map((o) => ({ value: o.ms, label: o.label }))}
                onPick={(ms) => {
                  setClearAfter(ms)
                  /* Changing the timer alone is a change worth saving: the
                     field has not been touched, so nothing else will. */
                  if (status === (me.status_text ?? '')) {
                    save({ status_text: status, status_until: statusUntil(ms) })
                  }
                }}
              />
            </div>
          )}
        </div>

        <div className="fld">
          <label>About you</label>
          <input value={bio} aria-label="About you"
            placeholder="A line or two"
            onChange={(e) => setBio(e.target.value)}
            onBlur={() => bio !== (me.bio ?? '') && save({ bio })} />
        </div>

        <div className="row">
          <span className="txt">
            <span className="t">Your colour</span>
            <span className="d">Behind your name, and on your card.</span>
          </span>
          <input type="color" value={accent} aria-label="Your colour"
            onChange={(e) => { setAccent(e.target.value); saveSoon({ accent: e.target.value }) }} />
        </div>
      </div>

      {/*
        * How your name is drawn.
        *
        * All of this already worked — the renderer, the wire and the server's
        * own list of what it accepts. There was simply nowhere to choose it,
        * so it read as a feature that had never been built rather than one
        * nobody could reach.
        */}
      <div className="card">
        <h4>Your name</h4>

        <div className="row">
          <span className="txt">
            <span className="t">Preview</span>
            <span className="d">What everybody else sees, as you change it.</span>
          </span>
          <span
            className={`nmprev ${look.className}`}
            style={look.style}
          >
            {name || me.username}
          </span>
        </div>

        <div className="row">
          <span className="txt">
            <span className="t">Effect</span>
            <span className="d">
              Gradient and shimmer paint the letters themselves, and use both
              colours. Glow keeps the letters and puts the colour around them.
            </span>
          </span>
        </div>
        <div className="thgrid">
          {EFFECTS.map(([id, label]) => (
            <button
              key={id}
              className={(me.name_effect ?? 'none') === id ? 'thsw on' : 'thsw'}
              onClick={() => save({ name_effect: id })}
            >
              <span className="thprev" style={{ display: 'grid', placeItems: 'center' }}>
                <span
                  className={id === 'none' ? '' : `fx-${id}`}
                  style={{
                    '--name-colour': accent,
                    '--name-colour-2': accent2,
                    ...(id === 'none' ? { color: accent } : {}),
                    fontWeight: 800,
                  } as React.CSSProperties}
                >
                  {name.slice(0, 7) || 'Name'}
                </span>
              </span>
              <span className="thn">{label}</span>
            </button>
          ))}
        </div>

        <div className="row">
          <span className="txt">
            <span className="t">Typeface</span>
            <span className="d">Only your name, nowhere else.</span>
          </span>
          <select value={me.name_font ?? 'default'}
            onChange={(e) => save({ name_font: e.target.value as NameFont })}>
            {FONTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>

        <div className="row">
          <span className="txt">
            <span className="t">Colour</span>
            <span className="d">
              Chosen from these rather than from the whole wheel: most of it is
              unreadable on a dark background, and a name nobody can read is
              not a name.
            </span>
          </span>
        </div>
        <div className="swatches">
          {NAME_COLOURS.map((c) => (
            <button
              key={c.id}
              className={accent.toLowerCase() === c.hex.toLowerCase() ? 'sw2 on' : 'sw2'}
              style={c.hex ? { background: c.hex } : undefined}
              title={c.name}
              aria-label={c.name}
              onClick={() => {
                const hex = c.hex || ''
                setAccent(hex || '#3FE0E8')
                save({ accent: hex })
              }}
            />
          ))}
          {/* And anything at all, for somebody who wants a colour that is not
              on the list — theirs to get wrong. */}
          <input type="color" value={accent} aria-label="Any other colour"
            onChange={(e) => { setAccent(e.target.value); saveSoon({ accent: e.target.value }) }} />
        </div>

        <div className="row">
          <span className="txt">
            <span className="t">Second colour</span>
            <span className="d">
              Where a gradient or a shimmer runs to. Nothing else uses it.
            </span>
          </span>
          <input type="color" value={accent2} aria-label="Your second colour"
            onChange={(e) => { setAccent2(e.target.value); saveSoon({ accent_2: e.target.value }) }} />
        </div>
      </div>

      <div className="card">
        <h4>Where people see you</h4>
        {PRESENCES.map(([id, label, detail]) => (
          <button
            key={id}
            className={me.presence === id ? 'radio on' : 'radio'}
            onClick={() => save({ presence: id })}
          >
            <span className={`dot ${id}`} />
            <span>
              <b>{label}</b><br />
              <span style={{ fontSize: '.85em', color: 'var(--fnt)' }}>{detail}</span>
            </span>
          </button>
        ))}
        {said && <p className="hint">{said}</p>}
      </div>

      {gifs && (
        <GifPicker
          server={server}
          anchor={gifs}
          onPick={(g) => { void wearGif(g) }}
          onClose={() => setGifs(null)}
        />
      )}
    </>
  )
}

/*
 * The four the server accepts, in its own words.
 *
 * `dnd` rather than `busy` and `idle` rather than `away`: the server checks
 * the string against its own list and refuses anything else, so a friendlier
 * spelling here would be a button that always fails.
 */
/* The server checks each against its own list and refuses anything else, so
   these spellings are its spellings and not friendlier ones. */
const EFFECTS: ReadonlyArray<readonly [NameEffect, string]> = [
  ['none', 'None'],
  ['glow', 'Glow'],
  ['gradient', 'Gradient'],
  ['shimmer', 'Shimmer'],
  ['outline', 'Outline'],
]

const FONTS: ReadonlyArray<readonly [NameFont, string]> = [
  ['default', 'The app’s own'],
  ['display', 'Display'],
  ['serif', 'Serif'],
  ['mono', 'Monospace'],
  ['system', 'Your system’s'],
]

const PRESENCES: ReadonlyArray<readonly [string, string, string]> = [
  ['online', 'Online', 'Available and visible'],
  ['idle', 'Idle', 'Away from the keyboard'],
  ['dnd', 'Do not disturb', 'No notifications at all'],
  ['offline', 'Invisible', 'You look offline and everything still works'],
]
