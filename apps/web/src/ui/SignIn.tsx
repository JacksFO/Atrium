import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { Scene } from './Scene'
import type { Api } from '../lib/api'

/**
 * The way in.
 *
 * Two panels on a wide screen and one on a narrow one. The left is what the
 * place is; the right is the thing you came to do. Putting the art behind the
 * form instead — the obvious version — makes every field sit on a different
 * colour, and the fields are the part that has to be easy.
 */
export function SignIn({ server, onIn, invite: arrivedWith }: {
  server: Api
  onIn: (token: string) => void
  /**
   * A code somebody arrived holding, from an invite link.
   *
   * It fills the box and picks the tab, both: somebody following an invite
   * is far likelier to be new than to be signing back in, and being shown a
   * sign-in form with no mention of the invite reads as the link having gone
   * to the wrong place.
   */
  invite?: string
}) {
  const [tab, setTab] = useState<'login' | 'signup'>(arrivedWith ? 'signup' : 'login')
  /*
   * What the front door is actually doing, asked rather than assumed.
   *
   * This screen used to state flatly that everyone needs a code, which
   * stopped being true the moment open registration was turned on - and copy
   * cannot know that on its own. Somebody was told they needed a code by an
   * app that would have let them straight in.
   *
   * Null until the answer comes back, and the wording waits for it rather
   * than guessing and correcting itself a moment later.
   */
  const [door, setDoor] = useState<{ openRegistration: boolean } | null>(null)
  useEffect(() => {
    let alive = true
    void server.get<{ openRegistration?: boolean }>('/api/signup')
      .then((r) => {
        if (!alive) return
        setDoor({
          openRegistration: r.openRegistration !== false,
        })
      })
      .catch(() => {
        /* An older server has no such route. The kinder assumption is that
           the door is open: telling somebody they need a code they cannot
           get is worse than letting them try and be refused. */
        if (alive) setDoor({ openRegistration: true })
      })
    return () => { alive = false }
  }, [server])
  const [invite, setInvite] = useState(arrivedWith ?? '')
  const [name, setName] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const isLogin = tab === 'login'

  async function go(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      const path = isLogin ? '/api/login' : '/api/register'
      const r = await server.post<{ token?: string }>(path, {
        username: name,
        password: pass,
        /* Only when making an account, and only when there is one: the
           server takes an invite here and puts the new account straight into
           that server, so they arrive somewhere rather than on an empty
           Home. */
        ...(isLogin || !invite.trim() ? {} : { invite: invite.trim() }),
      })
      if (!r.token) throw new Error('The server did not say who you are.')
      onIn(r.token)
    } catch (e) {
      /* The server's own words. It knows whether the name is taken or the
         password is short; this does not, and guessing would be worse. */
      setErr(e instanceof Error ? e.message : 'That did not work.')
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <div className="gatebox">
        <div className="gside">
          <Scene seed={4242} tall />
          <span className="vg" />
          <div className="gtx">
            <span className="mark"><Icon name="home" size={20} /></span>
            <h1>Atrium</h1>
            {/*
              * What the app is, to somebody who has never seen it.
              *
              * This used to pitch it as running on your own hardware, with a
              * line about nobody owning it and whoever ran the machine
              * holding no rank. Both were about how it is hosted, which is
              * not a thing anybody signing up for a chat app thinks about -
              * and the second told a stranger there was an operator at all,
              * which is the one thing this screen has no reason to raise.
              *
              * What is left is what is true from their side: their own
              * server, nobody in it but who they ask, and calls that go
              * straight between people.
              */}
            <p>Your own server, and the people you want in it.</p>
            <ul>
              <li>
                <Icon name="shield" size={15} />
                <span>A server you make is yours. Nobody outside it has any
                  say in what happens inside it.</span>
              </li>
              <li>
                <Icon name="people" size={15} />
                <span>You arrive knowing nobody, until you add somebody or
                  share a server.</span>
              </li>
              <li>
                <Icon name="vol" size={15} />
                <span>Voice and video go straight between people, so nothing
                  in between hears a byte of it.</span>
              </li>
            </ul>
          </div>
        </div>

        <form className="gbd" onSubmit={go}>
          <div className="tabs2">
            <button type="button" className={isLogin ? 'on' : ''}
              onClick={() => setTab('login')}>Sign in</button>
            <button type="button" className={!isLogin ? 'on' : ''}
              onClick={() => setTab('signup')}>Make an account</button>
          </div>
          <h2>{isLogin ? 'Welcome back' : 'Start from nothing'}</h2>
          <p className="sub">
            {isLogin
              ? 'Pick up where you left off.'
              : 'You start with no servers and no friends — one of your own to begin with.'}
          </p>
          {err && (
            <div className="err"><Icon name="info" size={15} /><span>{err}</span></div>
          )}
          <div className="fld">
            <label htmlFor="gname">Name</label>
            <input id="gname" type="text" value={name} autoComplete="username"
              spellCheck={false} placeholder="what people will see"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="fld">
            <label htmlFor="gpass">Password</label>
            <input id="gpass" type="password" value={pass}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              placeholder={isLogin ? 'your password' : 'four characters or more'}
              onChange={(e) => setPass(e.target.value)} />
          </div>
          {/* Only where it does something. The server takes an invite when
              an account is made and ignores one on the way back in, so a box
              for it on the sign-in tab is a box that quietly does nothing. */}
          {!isLogin && (
            <div className="fld">
              {/*
                * An invite is for a server somebody has asked you into, and
                * nothing else.
                *
                * There used to be a second thing it accepted - a code that
                * claimed the whole install - and the field changed its label,
                * its placeholder and its hint to say so. That is gone: this
                * is one app people sign up to, and the first person through
                * the door is just the first person.
                */}
              {/*
                * Called optional only where it is.
                *
                * Signing up is either open to anybody or by invitation, and
                * this says which. Labelling it optional when it is not is
                * the sentence that lets somebody fill the form in twice.
                */}
              <label htmlFor="ginvite">
                {door && !door.openRegistration ? 'Invite code' : 'Invite code (optional)'}
              </label>
              <input id="ginvite" type="text" value={invite}
                spellCheck={false}
                placeholder={door && !door.openRegistration
                  ? 'the code somebody sent you'
                  : 'only if somebody sent you one'}
                onChange={(e) => setInvite(e.target.value)} />
              <p className="hint">
                {door && !door.openRegistration
                  ? 'Making an account here is by invitation. Paste the code'
                    + ' somebody sent you.'
                  : 'Leave this empty unless somebody sent you an invite. You can'
                    + ' join a server at any time afterwards.'}
              </p>
            </div>
          )}
          <button className="btn p gbtn" type="submit" disabled={busy}>
            {busy ? 'One moment…' : isLogin ? 'Sign in' : 'Create it'}
          </button>
          <p className="gswap">
            {isLogin ? 'New here? ' : 'Been here before? '}
            <button type="button" onClick={() => setTab(isLogin ? 'signup' : 'login')}>
              {isLogin ? 'Make an account' : 'Sign in'}
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}
