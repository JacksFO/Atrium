import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ServerPane, serverPanesFor } from './ServerSettings'
import { emptyWorld, type World } from '../lib/world'
import type { Api } from '../lib/api'
import type { Space, User } from '../lib/wire'

const me: User = {
  id: 'me', username: 'me', discriminator: '0001', verified: 0, display_name: 'Me',
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
}

const space: Space = {
  id: 's1', name: 'Somewhere', description: '', icon_path: null, banner_path: null,
  owner_id: 'someone-else', position: 0, created_at: 0,
} as Space

/* With a role in it: the editor is what carries the permission switches, and
   a world with no roles renders no editor — so an assertion about a switch
   would pass for having nothing to switch. */
function world(): World {
  const w = emptyWorld(me)
  w.roles = [{
    id: 'r1', space_id: 's1', name: 'Moderator', colour: '#8395A6', position: 1,
    permissions: '["manage_messages"]', kind: 'custom', hoist: 0, created_at: 0,
  }]
  return w
}
const server = { get: async () => ({}), post: async () => ({}) } as unknown as Api
const noop = () => {}

/** The panes offered, by name, for an account holding exactly these. */
const offered = (permissions: string[]) =>
  serverPanesFor(permissions).map(([, label]) => label)

const roles = (permissions: string[]) => renderToStaticMarkup(
  <ServerPane id="roles" server={server} world={world()} space={space}
    permissions={permissions} onChanged={noop} onClose={noop} />,
)

describe('which panes are there', () => {
  /*
   * A gated pane is absent, not shown and refused. That is what makes a
   * permission bug read as a feature nobody built — so both directions have
   * to be asserted, or "absent" could equally be "never written".
   *
   * Asked of the list itself now rather than of rendered markup. The panes
   * moved into the one settings window, so the thing that decides is this
   * function, and a `toContain` against the whole window would also match
   * the word wherever else it appeared in it.
   */
  it('is decided by what this account may do', () => {
    expect(offered(['manage_roles'])).toContain('Roles')
    expect(offered(['manage_roles'])).not.toContain('Invites')
    expect(offered(['manage_roles'])).not.toContain('Overview')
  })

  it('and each one appears with its own permission', () => {
    expect(offered(['manage_space'])).toContain('Overview')
    expect(offered(['manage_channels'])).toContain('Channels')
    expect(offered(['create_invite'])).toContain('Invites')
    /* Members is behind managing roles, because handing one out is the whole
       of what it does — removing somebody is its own permission, asked per
       row rather than for the pane. */
    expect(offered(['manage_roles'])).toContain('Members')
    expect(offered(['create_invite'])).not.toContain('Members')
    expect(offered(['view_audit_log'])).toContain('Audit log')
    expect(offered(['manage_space'])).not.toContain('Audit log')
  })

  /*
   * Holding none of them offers nothing at all.
   *
   * This used to be a screen saying so, because the server's settings were
   * their own window and it had nothing else to put on it. They share the
   * window with your own settings now, so the server simply does not appear —
   * and the caller is what leaves the heading off, since a heading with
   * nothing under it is worse than the sentence was.
   */
  it('and holding none of them offers no panes at all', () => {
    expect(offered([])).toEqual([])
  })
})

describe('a permission somebody does not hold themselves', () => {
  /*
   * You cannot give away what you do not hold, and the server refuses it. So
   * the switch is there but disabled and says why — absent, it would look
   * like a permission this app does not have, and enabled it would be a
   * refusal waiting to happen.
   */
  it('is shown but cannot be handed on', () => {
    const out = roles(['manage_roles'])
    expect(out).toContain('You do not hold this yourself')
    expect(out).toContain('disabled')
  })

  it('while one they do hold is offered', () => {
    const out = roles(['manage_roles', 'kick_members'])
    expect(out).toContain('Show somebody the door')
  })
})

/**
 * Reaching the controls you were given.
 *
 * Every control for acting on a person lives in the Members pane, and that
 * pane was gated on manage_roles alone - so an account trusted to remove
 * people, or to bar them, or to rename them, and nothing else, could not
 * reach a single one of them. Adding the ban button made it obvious rather
 * than causing it: that account got a Bans pane it could lift bans from and
 * nowhere at all to make one.
 *
 * Which is the failure this file's own header describes: a feature that was
 * built, cannot be reached, and gets reported as never built.
 */
describe('a moderator who cannot hand out roles', () => {
  it('can still open the pane the people are in', () => {
    for (const held of ['kick_members', 'ban_members', 'manage_nicknames']) {
      expect(offered([held]), held).toContain('Members')
    }
  })

  /* And barring somebody without also being able to reach them is the
     specific shape it took. */
  it('and does not get a Bans pane with no way to make one', () => {
    const mine = offered(['ban_members'])
    expect(mine).toContain('Bans')
    expect(mine).toContain('Members')
  })

  /* Still absent for somebody holding none of them - the pane is gated, not
     opened up. */
  it('while somebody with none of them still cannot', () => {
    expect(offered(['send_messages', 'create_invite'])).not.toContain('Members')
  })

  /*
   * And the role switches inside it are absent for them.
   *
   * The pane's gate used to be the same permission the switches need, so
   * they were only ever right by accident. Opening it wider without this
   * would draw a control that the server refuses - the exact thing the
   * absent-not-disabled rule exists to prevent.
   */
  it('and sees no role switches in it', () => {
    const members = (permissions: string[]) => renderToStaticMarkup(
      <ServerPane id="members" server={server} world={world()} space={space}
        permissions={permissions} onChanged={noop} onClose={noop} />,
    )
    expect(members(['kick_members'])).not.toContain('There are no roles you can hand out')
  })
})
