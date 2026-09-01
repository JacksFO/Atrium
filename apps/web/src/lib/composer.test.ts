import { describe, expect, it } from 'vitest'
import { applyFormat, commandInDraft, opensSomething, SLASH } from './composer'

describe('a command in a finished draft', () => {
  it('is found with what it should act on', () => {
    const got = commandInDraft('/shrug hello')
    expect(got?.cmd.name).toBe('shrug')
    expect(got?.rest).toBe('hello')
  })

  it('is nothing for a word that is not one', () => {
    expect(commandInDraft('/nonsense')).toBeNull()
  })

  it('and the text ones turn the line into what they promise', () => {
    const me = SLASH.find((c) => c.name === 'me')
    expect(me?.run?.('waves')).toBe('*waves*')
    const spoiler = SLASH.find((c) => c.name === 'spoiler')
    expect(spoiler?.run?.('secret')).toBe('||secret||')
  })

  it('while the ones that open something have nothing to run', () => {
    expect(SLASH.find((c) => c.name === 'gif')?.run).toBeUndefined()
  })
})

describe('formatting a selection', () => {
  it('wraps it, and moves the selection with it', () => {
    const out = applyFormat('hello', 0, 5, '**')
    expect(out.text).toBe('**hello**')
    expect(out.text.slice(out.start, out.end)).toBe('hello')
  })

  it('unwraps it again when it is already wrapped in that', () => {
    const out = applyFormat('**hello**', 2, 7, '**')
    expect(out.text).toBe('hello')
    expect(out.text.slice(out.start, out.end)).toBe('hello')
  })

  /* Wrapping and unwrapping have to agree about which marker owns a run of
     stars, or italic applied to bold peels one star off and leaves a mess. */
  it('does not mistake bold for its own italic pair', () => {
    const out = applyFormat('**hello**', 2, 7, '*')
    expect(out.text).toBe('***hello***')
  })

  it('and removing the italic from that puts it back', () => {
    const out = applyFormat('***hello***', 3, 8, '*')
    expect(out.text).toBe('**hello**')
  })
})

describe('a command that opens something', () => {
  /*
   * `/gif` and `/poll` do not turn into text — they open a panel. A command
   * with no `run` has nothing to send, and sending the words instead puts
   * "/gif" in the channel, which is the command appearing to do nothing.
   *
   * Told apart by what they are rather than by their names, so a command
   * added later is covered by the same rule without anybody remembering to
   * come back here.
   */
  it('has nothing to turn into a message', () => {
    const opens = SLASH.filter((c) => c.kind === 'action')
    expect(opens.length).toBeGreaterThan(0)
    for (const c of opens) expect(c.run, `/${c.name}`).toBeUndefined()
  })

  it('while one that writes text always has something to write', () => {
    for (const c of SLASH.filter((x) => x.kind === 'text')) {
      expect(c.run, `/${c.name}`).toBeTypeOf('function')
    }
  })

  /* So the composer can ask "is this a message?" of any draft and get the
     right answer without knowing which commands exist. */
  it('and commandInDraft offers no body for one', () => {
    const found = commandInDraft('/gif cats')
    expect(found?.cmd.name).toBe('gif')
    expect(found?.cmd.run).toBeUndefined()
  })
})

describe('a draft that is a command rather than a message', () => {
  /*
   * This is the whole rule, in one place. A command with no `run` has nothing
   * to turn into text, and sending it puts its own name in the channel.
   *
   * It was handled by naming /gif at the keyboard, so /poll — the only other
   * one — sent the word "/poll". Asked of the command now rather than of its
   * name, so one added later cannot be forgotten in the same way.
   */
  it('is recognised by having nothing to send', () => {
    expect(opensSomething('/gif')?.name).toBe('gif')
    expect(opensSomething('/gif cats')?.name).toBe('gif')
  })

  it('while a command that writes text is a message', () => {
    expect(opensSomething('/shrug')).toBe(null)
    expect(opensSomething('/me waves')).toBe(null)
  })

  it('and so is anything that is not a command at all', () => {
    expect(opensSomething('hello')).toBe(null)
    expect(opensSomething('/nosuchcommand')).toBe(null)
    expect(opensSomething('and/or')).toBe(null)
  })

  /* Every action command is covered by the rule, whatever it is called —
     which is the point of asking what it is rather than what it is named. */
  it('and covers every command that opens something', () => {
    for (const c of SLASH.filter((x) => x.kind === 'action')) {
      expect(opensSomething(`/${c.name}`)?.name, `/${c.name}`).toBe(c.name)
    }
  })
})

describe('polls', () => {
  /*
   * They exist now: tables, two routes, and the counts riding on the message
   * the way a reaction does. This used to assert the opposite, and it was
   * right to — a command that can only open something that is not there, or
   * send the word "/poll" into the channel, is worse than a missing one.
   */
  it('are offered, now that this server has them', () => {
    expect(SLASH.map((c) => c.name)).toContain('poll')
  })

  /* And it opens something rather than turning into text, which is the
     difference between the two kinds of command. */
  it('and asking is opening a box, not writing a message', () => {
    const poll = SLASH.find((c) => c.name === 'poll')
    expect(poll?.kind).toBe('action')
    expect(poll?.run).toBeUndefined()
    expect(opensSomething('/poll')?.name).toBe('poll')
  })
})
