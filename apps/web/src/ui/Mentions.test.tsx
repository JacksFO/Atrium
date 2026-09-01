import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './Markdown'
import { Composer, mentionAt, mentionMatches, type Mention } from './Composer'
import { render as parse, type RenderOptions } from '../lib/markdown'

/**
 * Naming somebody, and still naming them tomorrow.
 *
 * A mention used to be the name as it was typed. That is a copy of what
 * somebody was called at one moment, so the first rename left every message
 * that had ever addressed them pointing at nobody — the @ stopped matching
 * and quietly turned back into a stray @.
 */

const people: Mention[] = [
  { id: 'u1', name: 'Rafael', handle: 'paganotti' },
  { id: 'u2', name: 'Jack', handle: 'jack' },
]

const options = (nameById: Record<string, string>, meId = 'me'): RenderOptions => ({
  nameById: new Map(Object.entries(nameById)),
  idByName: new Map(Object.entries(nameById).map(([id, n]) => [n.toLowerCase(), id])),
  meId,
  names: new Set(Object.values(nameById)),
})

describe('a mention written as an id', () => {
  it('is drawn as the name that person has now', () => {
    const [block] = parse('hi <@u1>', options({ u1: 'Rafael' }))
    const node = block?.k === 'line' ? block.kids[1] : null
    expect(node).toMatchObject({ k: 'mention', name: 'Rafael', id: 'u1' })
  })

  /* The whole point. Same message, same body, new name. */
  it('and follows them when they rename', () => {
    const [block] = parse('hi <@u1>', options({ u1: 'Rafa the Third' }))
    const node = block?.k === 'line' ? block.kids[1] : null
    expect(node).toMatchObject({ name: 'Rafa the Third', id: 'u1' })
  })

  it('and is marked as yours by who it is, not what you are called', () => {
    const [block] = parse('<@me>', options({ me: 'Anything At All' }, 'me'))
    const node = block?.k === 'line' ? block.kids[0] : null
    expect(node).toMatchObject({ k: 'mention', me: true })
  })

  /* Somebody this client has never heard of is still a person, not the raw
     token — which is punctuation nobody typed. */
  it('and a stranger is a mention without a name, never the token', () => {
    const [block] = parse('<@nobody>', options({ u1: 'Rafael' }))
    const line = block?.k === 'line' ? block.kids : []
    expect(line[0]).toMatchObject({ k: 'mention', id: 'nobody' })
    expect(JSON.stringify(line)).not.toContain('<@')
  })
})

describe('a mention written as text, from before', () => {
  it('still finds who it meant', () => {
    const [block] = parse('hi @Rafael', options({ u1: 'Rafael' }))
    const node = block?.k === 'line' ? block.kids[1] : null
    expect(node).toMatchObject({ k: 'mention', id: 'u1' })
  })

  /*
   * And is drawn as they are called now, not as the message spells them.
   *
   * A handle does not change, so `@paganotti` keeps finding them through any
   * rename — and once found, what is shown is their name today. This is the
   * assertion that fails if the typed text is drawn instead.
   */
  it('and shows the name they have now, not the one that was typed', () => {
    const o = options({ u1: 'Rafa the Third' })
    const idByName = new Map(o.idByName)
    idByName.set('paganotti', 'u1')
    const [block] = parse('hi @paganotti', { ...o, idByName })
    const node = block?.k === 'line' ? block.kids[1] : null
    expect(node).toMatchObject({ k: 'mention', id: 'u1', name: 'Rafa the Third' })
  })

  /* A stray @ is a stray @. It must not become a control. */
  it('and an @ nobody answers to stays plain', () => {
    const [block] = parse('email @ nowhere', options({ u1: 'Rafael' }))
    const kinds = (block?.k === 'line' ? block.kids : []).map((n) => n.k)
    expect(kinds).not.toContain('mention')
  })
})

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null; host = null
})
function mount(ui: React.ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root?.render(ui) })
  return host
}

describe('clicking a mention', () => {
  it('opens the person it names', () => {
    const onWho = vi.fn()
    const el = mount(
      <Markdown text="hi <@u1>" options={options({ u1: 'Rafael' })} onWho={onWho} />,
    )
    const btn = el.querySelector('button.mention')
    expect(btn?.textContent).toBe('@Rafael')
    act(() => { (btn as HTMLElement).click() })
    expect(onWho).toHaveBeenCalledWith('u1', expect.anything())
  })

  /* Nobody to open is not a button. A control that does nothing is worse
     than no control, because it reads as broken rather than absent. */
  it('but an @ nobody answers to is not a button', () => {
    const el = mount(<Markdown text="@ghost" options={options({ u1: 'Rafael' })} onWho={vi.fn()} />)
    expect(el.querySelector('button.mention')).toBe(null)
  })
})

describe('typing an @', () => {
  it('sees the name being typed and not the ones already sent', () => {
    expect(mentionAt('hello @raf', 10)).toEqual({ from: 6, query: 'raf' })
    /* The caret is back in the first name, so that is the one being typed. */
    expect(mentionAt('@one and @two', 4)).toEqual({ from: 0, query: 'one' })
    expect(mentionAt('nothing here', 12)).toBe(null)
    /* A space ends it. */
    expect(mentionAt('@raf said hi', 12)).toBe(null)
  })

  it('and never inside an address', () => {
    expect(mentionAt('a@b.com', 7)).toBe(null)
  })

  it('offers who starts with it before who merely contains it', () => {
    const out = mentionMatches(people, 'ja')
    expect(out[0]?.id).toBe('u2')
    expect(mentionMatches(people, 'pag')[0]?.id).toBe('u1')
    expect(mentionMatches(people, 'zzz')).toEqual([])
  })

  /*
   * The name goes in the box; the id goes on the wire.
   *
   * Writing `<@0f3c…>` straight into the box put a uuid in the middle of the
   * sentence somebody was writing, so the message became unreadable to the
   * person writing it. What is stored still has to be the id, or a mention
   * cannot survive a rename — so the swap happens on the way out.
   */
  it('puts a readable name in the box', () => {
    const onSend = vi.fn()
    const el = mount(
      <Composer name="general" kind="text" onSend={onSend} mentionable={people} />,
    )
    const box = el.querySelector('textarea') as HTMLTextAreaElement
    /* Through the native setter, or React's own value tracking sees no
       change and never calls onChange — the box would hold the text and the
       component would never have been told. */
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value',
    )?.set as (v: string) => void
    act(() => {
      box.focus()
      setValue.call(box, 'hi @raf')
      box.selectionStart = 7
      box.selectionEnd = 7
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const row = el.querySelector('.picker .pitem') as HTMLElement
    expect(row?.textContent).toContain('Rafael')
    act(() => {
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(box.value).toBe('hi @paganotti ')
  })

  /*
   * And leaves the caret past the name, not where it was.
   *
   * Typing "@raf" and choosing left the caret four characters in, because it
   * was put back where it had been while the name grew underneath it - so the
   * next thing typed landed inside somebody's name.
   *
   * This was covered, against a copy of the insertion logic in lib/composer
   * that the box has never called. Asked of the box itself now: the caret is
   * a property of the thing somebody is typing into, and a helper returning
   * the right number proves nothing about where it ends up.
   */
  it('and leaves the caret after it, not inside the name', () => {
    const onSend = vi.fn()
    const el = mount(
      <Composer name="general" kind="text" onSend={onSend} mentionable={people} />,
    )
    const box = el.querySelector('textarea') as HTMLTextAreaElement
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value',
    )?.set as (v: string) => void
    act(() => {
      box.focus()
      setValue.call(box, 'hi @raf')
      box.selectionStart = 7
      box.selectionEnd = 7
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const row = el.querySelector('.picker .pitem') as HTMLElement
    act(() => { row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(box.value).toBe('hi @paganotti ')
    expect(box.selectionStart).toBe(box.value.length)
  })
})

/**
 * Commands, offered rather than remembered.
 *
 * Every one of these already worked when typed out in full, and nothing ever
 * said they existed — so from the outside the app had no slash commands. A
 * feature nobody can find is one nobody has.
 */
describe('typing a slash', () => {
  const type = (el: HTMLElement, text: string) => {
    const box = el.querySelector('textarea') as HTMLTextAreaElement
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value',
    )?.set as (v: string) => void
    act(() => {
      box.focus()
      setValue.call(box, text)
      box.selectionStart = text.length
      box.selectionEnd = text.length
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    return box
  }

  it('offers the commands', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    type(el, '/')
    expect(el.querySelector('.picker')).toBeTruthy()
    expect(el.textContent).toContain('/shrug')
  })

  it('and narrows as it is typed', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    type(el, '/shr')
    const items = [...el.querySelectorAll('.pitem')]
    expect(items).toHaveLength(1)
    expect(items[0]?.textContent).toContain('shrug')
  })

  /* The name and a space, not the command run — every one of them takes
     something after it, and running it on being named would send an empty
     /me the instant somebody finished typing the word. */
  it('and completing one leaves room to write the rest', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    const box = type(el, '/sp')
    act(() => {
      (el.querySelector('.pitem') as HTMLElement)
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(box.value).toBe('/spoiler ')
  })

  /* Once there is an argument the command has been chosen, and a menu over
     the top of what somebody is writing is in the way. */
  it('and closes once something has been written after it', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    type(el, '/me having a think')
    expect(el.querySelector('.picker')).toBe(null)
  })

  it('and a slash in the middle of a sentence is a slash', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    type(el, 'and/or')
    expect(el.querySelector('.picker')).toBe(null)
  })
})

/**
 * Moving through the menu.
 *
 * The check that puts the highlight back on the first row ran on every key
 * up, arrow keys included — so Down moved it and this put it straight back,
 * and the menu could not be moved through at all. The caret moving is not the
 * search changing.
 */
describe('the keys that drive the menu', () => {
  const typeIn = (el: HTMLElement, text: string) => {
    const box = el.querySelector('textarea') as HTMLTextAreaElement
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value',
    )?.set as (v: string) => void
    act(() => {
      box.focus()
      setValue.call(box, text)
      box.selectionStart = text.length
      box.selectionEnd = text.length
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    return box
  }

  /** A key, the way the box really receives one: down, then up. */
  const key = (box: HTMLTextAreaElement, k: string) => act(() => {
    box.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
    box.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }))
  })

  const chosen = (el: HTMLElement) =>
    [...el.querySelectorAll('.pitem')].findIndex((n) => n.classList.contains('on'))

  it('starts on the first row', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    typeIn(el, '/')
    expect(chosen(el)).toBe(0)
  })

  it('and Down moves it, and stays moved', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    const box = typeIn(el, '/')
    key(box, 'ArrowDown')
    expect(chosen(el)).toBe(1)
    key(box, 'ArrowDown')
    expect(chosen(el)).toBe(2)
  })

  it('and Up wraps round to the end', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    const box = typeIn(el, '/')
    const rows = el.querySelectorAll('.pitem').length
    key(box, 'ArrowUp')
    expect(chosen(el)).toBe(rows - 1)
  })

  /* But typing does start again, or a narrowed list would keep a highlight
     on a row that is no longer in it. */
  it('and typing another letter starts again at the first', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    const box = typeIn(el, '/')
    key(box, 'ArrowDown')
    expect(chosen(el)).toBe(1)
    typeIn(el, '/s')
    expect(chosen(el)).toBe(0)
  })
})

/**
 * A shortcode, offered as the character it stands for.
 *
 * `:fire:` has always been swapped for the glyph in a sent message, and
 * nothing ever offered one while typing — so the feature existed for anybody
 * who had memorised the names.
 */
describe('typing a colon', () => {
  const typeIn = (el: HTMLElement, text: string) => {
    const box = el.querySelector('textarea') as HTMLTextAreaElement
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value',
    )?.set as (v: string) => void
    act(() => {
      box.focus()
      setValue.call(box, text)
      box.selectionStart = text.length
      box.selectionEnd = text.length
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    return box
  }

  it('offers emoji whose name starts with it', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    typeIn(el, 'hey :fir')
    expect(el.querySelector('.picker')).toBeTruthy()
    expect(el.textContent).toContain(':fire:')
  })

  /* And puts in the character, not the name — what is on screen while
     writing is then what is on screen after sending. */
  it('and inserts the character itself', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    const box = typeIn(el, 'hey :fir')
    act(() => {
      (el.querySelector('.pitem') as HTMLElement)
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(box.value).toBe('hey 🔥 ')
  })

  /* A colon in a sentence is a colon. */
  it('and leaves an ordinary colon alone', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    typeIn(el, 'the plan: ')
    expect(el.querySelector('.picker')).toBe(null)
  })
})

/**
 * A spoiler that can be read.
 *
 * The stylesheet has always had a `.spo.open` that shows the words, and
 * nothing ever put that class on anything — so a spoiler was unreadable text
 * with no way to read it, which is not a spoiler but a deletion.
 */
describe('a spoiler', () => {
  it('is hidden, and opens when pressed', () => {
    const el = mount(<Markdown text="the butler ||did it||" />)
    const spo = el.querySelector('.spo') as HTMLElement
    expect(spo).toBeTruthy()
    expect(spo.className).not.toContain('open')
    act(() => { spo.click() })
    expect((el.querySelector('.spo') as HTMLElement).className).toContain('open')
  })

  it('and says it can be pressed before it is', () => {
    const el = mount(<Markdown text="||shh||" />)
    expect(el.querySelector('.spo')?.getAttribute('role')).toBe('button')
    act(() => { (el.querySelector('.spo') as HTMLElement).click() })
    /* Opened, it is text again rather than a control that does nothing. */
    expect(el.querySelector('.spo')?.getAttribute('role')).toBe(null)
  })
})

/**
 * A role named in a message.
 *
 * A group rather than a person, so there is no card to open — and drawn in
 * the role's own colour, which is how a role is recognised everywhere else.
 */
describe('a role mention', () => {
  const withRole = {
    roleById: new Map([['r1', { name: 'Moderators', colour: '#ff0000' }]]),
    myRoles: new Set(['r1']),
  }

  it('is drawn by name, in its colour', () => {
    const el = mount(<Markdown text="ping <@&r1> please" options={withRole} />)
    const role = el.querySelector('.mention.role') as HTMLElement
    expect(role?.textContent).toBe('@Moderators')
    expect(role.style.getPropertyValue('--role')).toBe('#ff0000')
  })

  it('and is not a button, because a group is not somebody to open', () => {
    const el = mount(
      <Markdown text="<@&r1>" options={withRole} onWho={vi.fn()} />,
    )
    expect(el.querySelector('button.mention')).toBe(null)
  })

  /* It lights up for everybody who holds it. */
  it('and counts as yours when you hold it', () => {
    const el = mount(<Markdown text="<@&r1>" options={withRole} />)
    /* On the class list, not in the string — "mention" begins with "me", so
       a substring check passes whatever the answer is. */
    expect([...(el.querySelector('.mention.role') as HTMLElement).classList])
      .toContain('me')
  })

  it('but not when you do not', () => {
    const el = mount(
      <Markdown text="<@&r1>" options={{ ...withRole, myRoles: new Set<string>() }} />,
    )
    expect([...(el.querySelector('.mention.role') as HTMLElement).classList])
      .not.toContain('me')
  })
})

/**
 * The menu on the message box.
 *
 * A browser draws its own for a text box. Electron draws none at all — so in
 * the desktop app, right-clicking what you had just selected offered nothing
 * whatever: no copy, no paste, nothing. Drawn by the app, both get the same
 * one, and it can carry the formatting as well.
 */
describe('right-clicking the message box', () => {
  const withText = (text: string, from: number, to: number) => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    const box = el.querySelector('textarea') as HTMLTextAreaElement
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value',
    )?.set as (v: string) => void
    act(() => {
      box.focus()
      setValue.call(box, text)
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    box.selectionStart = from
    box.selectionEnd = to
    act(() => {
      box.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    return { el, box }
  }

  it('offers the formatting when something is selected', () => {
    const { el } = withText('hello world', 0, 5)
    expect(el.querySelector('.ctx') ?? document.querySelector('.ctx')).toBeTruthy()
    expect(document.body.textContent).toContain('Bold')
    expect(document.body.textContent).toContain('Strikethrough')
  })

  it('and copy, which was the thing that was actually missing', () => {
    withText('hello world', 0, 5)
    expect(document.body.textContent).toContain('Copy')
    expect(document.body.textContent).toContain('Paste')
  })

  /* Nothing selected: there is nothing to embolden, and offering it anyway
     is offering something that cannot happen. */
  it('but offers no formatting when nothing is selected', () => {
    withText('hello world', 4, 4)
    expect(document.body.textContent).not.toContain('Bold')
    expect(document.body.textContent).toContain('Paste')
  })

  it('and wraps the selection when one is chosen', () => {
    const { box } = withText('hello world', 0, 5)
    const bold = [...document.querySelectorAll('.ctx button')]
      .find((b) => b.textContent?.includes('Bold')) as HTMLElement
    act(() => { bold.click() })
    expect(box.value).toBe('**hello** world')
  })

  /* Pressed again, the marks come off — the alternative is `****hello****`. */
  it('and takes them off again when pressed twice', () => {
    const { box } = withText('**hello** world', 2, 7)
    const bold = [...document.querySelectorAll('.ctx button')]
      .find((b) => b.textContent?.includes('Bold')) as HTMLElement
    act(() => { bold.click() })
    expect(box.value).toBe('hello world')
  })
})
