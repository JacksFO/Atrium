import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MePane } from './MePane'
import type { Api } from '../lib/api'
import type { User } from '../lib/wire'

const me = (over: Partial<User> = {}): User => ({
  id: 'me', username: 'me', discriminator: '0001', verified: 0, display_name: 'Me',
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0, ...over,
})

const server = { patch: async () => ({}) } as unknown as Api
const draw = (u: User) => renderToStaticMarkup(
  <MePane server={server} me={u} onSaved={() => {}} />,
)

describe('your own profile', () => {
  it('offers the things a person actually changes', () => {
    const out = draw(me())
    expect(out).toContain('Name')
    expect(out).toContain('Status')
    expect(out).toContain('About you')
    expect(out).toContain('Picture')
  })

  /*
   * The four the server accepts, spelled its way. It checks the string
   * against its own list and refuses anything else, so `busy` for "do not
   * disturb" or `away` for "idle" would be a button that always fails —
   * which is exactly the kind of thing that reads as the feature being
   * broken rather than as a spelling mistake.
   */
  it('and offers presence in the server’s own words', () => {
    const out = draw(me())
    for (const id of ['online', 'idle', 'dnd', 'offline']) {
      expect(out, id).toContain(`dot ${id}`)
    }
    expect(out).not.toContain('dot busy')
    expect(out).not.toContain('dot away')
  })

  /* Clearing a picture is only worth offering when there is one — a Clear
     button beside nothing is a button that cannot do anything. */
  /*
   * A status can be given a moment to stop at - "back in 20", which nobody
   * wants still saying that tomorrow. Offered only where there is something
   * to clear: a timer on an empty status is a control for nothing.
   */
  it('offers no timer when there is no status to time', () => {
    expect(draw(me({ status_text: '' }))).not.toContain('Clear after')
  })

  it('and offers one as soon as there is', () => {
    const out = draw(me({ status_text: 'back in 20' }))
    expect(out).toContain('Clear after')
    /* What it is set to. The choices themselves are in the menu it opens,
       which is not drawn until it is opened - Picker.test.tsx has those. */
    expect(out).toContain('Don’t clear')
  })

  it('and offers to clear a picture only when there is one', () => {
    expect(draw(me())).not.toContain('Clear')
    expect(draw(me({ avatar_path: '/uploads/x.png' }))).toContain('Clear')
  })
})
