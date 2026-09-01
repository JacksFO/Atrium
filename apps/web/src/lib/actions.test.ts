import { describe, expect, it } from 'vitest'
import { actionsFor, editIsDelete } from './actions'
import { CONVERSATION_PERMISSIONS } from './permissions'
import type { Message } from './wire'

const msg = (author: string): Message => ({
  id: 'm1', channel_id: 'c1', author_id: author, body: 'hi', created_at: 1,
  edited_at: null, deleted_at: null, kind: 'text', reply_to: null,
  pinned_at: null, reactions: [], attachments: [],
})

const who = (id: string, permissions: string[] = []) => ({ id, permissions })

describe('what is offered on your own message', () => {
  it('includes editing and deleting', () => {
    const out = actionsFor(msg('me'), who('me'))
    expect(out).toContain('edit')
    expect(out).toContain('delete')
  })
})

describe('what is offered on somebody else’s', () => {
  /* The server allows editing only for what you wrote, so offering it on
     somebody else's is offering a refusal. */
  it('never includes editing, whatever they can do', () => {
    const out = actionsFor(msg('pat'), who('me', ['manage_messages', 'manage_roles']))
    expect(out).not.toContain('edit')
  })

  it('includes deleting only with the permission for it', () => {
    expect(actionsFor(msg('pat'), who('me'))).not.toContain('delete')
    expect(actionsFor(msg('pat'), who('me', ['manage_messages']))).toContain('delete')
  })
})

describe('pinning', () => {
  it('is its own permission', () => {
    expect(actionsFor(msg('pat'), who('me', ['manage_pins']))).toContain('pin')
    expect(actionsFor(msg('pat'), who('me'))).not.toContain('pin')
  })

  /* The two were one thing before pinning was separated out, and a server set
     up under the old rule should not quietly lose it. */
  it('and still comes with managing messages', () => {
    expect(actionsFor(msg('pat'), who('me', ['manage_messages']))).toContain('pin')
  })
})

describe('what everybody always has', () => {
  /*
   * Copying, and nothing else.
   *
   * Replying used to be in here. A reply is a message, so it was offered to
   * somebody who cannot write in the channel — who would compose one and be
   * refused by the server, which is the thing this file exists to avoid.
   */
  it('is copying', () => {
    expect(actionsFor(msg('pat'), who('me', []))).toEqual(['copy'])
  })

  it('and replying comes with being able to write here', () => {
    expect(actionsFor(msg('pat'), who('me', ['send_messages']))).toContain('reply')
    expect(actionsFor(msg('pat'), who('me', []))).not.toContain('reply')
  })

  /* Copying is the client reading its own screen. Gating it on a server's
     permission would be the client asking permission to do nothing. */
  it('including where the server has granted nothing at all', () => {
    expect(actionsFor(msg('pat'), who('me', []))).toContain('copy')
  })
})

describe('reacting', () => {
  it('is offered where it is allowed, and not where it is not', () => {
    expect(actionsFor(msg('pat'), who('me', ['add_reactions']))).toContain('react')
    expect(actionsFor(msg('pat'), who('me', ['send_messages']))).not.toContain('react')
  })

  /* A conversation has no server and no roles, so it has no list from the
     server either. Answering with nothing there takes reacting, attaching and
     pinning away from every private conversation in the app. */
  it('is offered in a conversation, which grants a fixed set', () => {
    const inDm = actionsFor(msg('pat'), who('me', [...CONVERSATION_PERMISSIONS]))
    expect(inDm).toContain('react')
    expect(inDm).toContain('pin')
    /* And still nobody may delete what somebody else wrote in one. */
    expect(inDm).not.toContain('delete')
  })
})

describe('an edit with nothing left in it', () => {
  /* The server refuses an empty body outright, which would leave somebody who
     cleared the box and pressed Enter with a message that did not change and
     no word about why. */
  it('is a deletion being asked about, not a refusal', () => {
    expect(editIsDelete('')).toBe(true)
    expect(editIsDelete('   ')).toBe(true)
    expect(editIsDelete('still here')).toBe(false)
  })
})
