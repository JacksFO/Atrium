import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from './Composer'

/**
 * The message box, pressed rather than read.
 *
 * Every other component test here renders to static markup, which cannot
 * press anything — so a guard that lives in an event handler is invisible to
 * it. That is exactly where this bug was: a command that opens something was
 * being sent as its own name, and the whole suite stayed green with the guard
 * taken out.
 */

let root: Root | null = null
let host: HTMLElement | null = null

function mount(ui: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(ui) })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

const type = (el: HTMLElement, text: string) => {
  const box = el.querySelector('textarea')!
  act(() => {
    /* React listens to the input event, and setting `value` alone does not
       raise one — the setter has to be the native one for React's own value
       tracker to notice the change. */
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return box
}

const enter = (box: HTMLElement) => {
  act(() => {
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

describe('pressing Enter', () => {
  it('sends what was written', () => {
    const onSend = vi.fn()
    const el = mount(<Composer name="general" kind="text" onSend={onSend} />)
    enter(type(el, 'hello'))
    expect(onSend).toHaveBeenCalledWith('hello')
  })

  /*
   * A command that opens something has nothing to turn into text, so sending
   * it puts its own name in the channel. It was guarded by naming /gif at the
   * keyboard, which is why /poll — the only other one — sent the word.
   */
  it('never sends a command that opens something', () => {
    const onSend = vi.fn()
    const onGif = vi.fn()
    const server = {} as never
    const el = mount(
      <Composer name="general" kind="text" onSend={onSend} server={server} onGif={onGif} />,
    )
    enter(type(el, '/gif cats'))
    expect(onSend).not.toHaveBeenCalled()
  })

  /* And a command that writes text is still a message, turned into what it
     writes rather than left as what was typed. */
  it('while a command that writes text becomes what it writes', () => {
    const onSend = vi.fn()
    const el = mount(<Composer name="general" kind="text" onSend={onSend} />)
    enter(type(el, '/shrug'))
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(String(onSend.mock.calls[0]?.[0])).toContain('¯')
  })

  /* Nothing to send is nothing to send, whatever the box has been through. */
  it('and sends nothing at all for an empty box', () => {
    const onSend = vi.fn()
    const el = mount(<Composer name="general" kind="text" onSend={onSend} />)
    enter(type(el, '   '))
    expect(onSend).not.toHaveBeenCalled()
  })
})

/**
 * The box is as tall as what is in it.
 *
 * A textarea is one row and stays one row: a paragraph becomes a single line
 * with a scrollbar inside it. The client this replaced grew; this one did not,
 * and nobody noticed for months because the browser spec that covers it was
 * being run against that other client.
 *
 * jsdom has no layout, so scrollHeight is always 0 and the height cannot be
 * measured here. What can be checked is that something is measuring it at
 * all - the effect exists, it runs when the draft changes, and it clears the
 * height before reading it, which is the part that lets the box shrink again
 * as well as grow.
 */
describe('the height of the box', () => {
  it('is set from the content, and reset before it is measured', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/ui/Composer.tsx'), 'utf8')
    /* The call, not the import - which comes first in the file. */
    const at = src.indexOf('useLayoutEffect(')
    expect(at, 'nothing measures the box at all').toBeGreaterThan(-1)
    const effect = src.slice(at, at + 400)
    expect(effect, 'the height is never cleared, so the box can grow but never shrink')
      .toContain("style.height = 'auto'")
    expect(effect, 'the height is not taken from the content').toContain('scrollHeight')
    expect(effect, 'it does not run when what is typed changes').toContain('[draft]')
  })

  /* And it is a layout effect, not an ordinary one: measuring after the
     browser has painted means a frame of the wrong height on every keystroke. */
  it('and measures before the frame is drawn', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/ui/Composer.tsx'), 'utf8')
    const at = src.indexOf('el.style.height')
    const before = src.slice(Math.max(0, at - 500), at)
    expect(before.lastIndexOf('useLayoutEffect('))
      .toBeGreaterThan(before.lastIndexOf('  useEffect('))
  })
})

/**
 * Bold, then italic, on the same words.
 *
 * The case this exists for: italic is one star and bold is two, so
 * italicising something already bold finds a star either side, decides it is
 * already italic, and takes one off each end - turning bold into italic
 * instead of adding to it.
 *
 * It was tested, against applyFormat in lib/composer, which the box had never
 * called; the box had its own copy that approximated the rule by looking at a
 * single character. There is one implementation now, and this asks the box
 * rather than the helper - the swap is the part that was never covered.
 */
describe('the formatting shortcuts', () => {
  const press = (box: HTMLElement, key: string) => {
    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', {
        key, ctrlKey: true, bubbles: true,
      }))
    })
  }
  const select = (box: HTMLTextAreaElement, from: number, to: number) => {
    box.selectionStart = from
    box.selectionEnd = to
  }

  it('wrap the selection', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    const box = type(el, 'hello') as HTMLTextAreaElement
    select(box, 0, 5)
    press(box, 'b')
    expect(box.value).toBe('**hello**')
  })

  it('and bolding then italicising gives both, not italic alone', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    const box = type(el, 'hello') as HTMLTextAreaElement
    select(box, 0, 5)
    press(box, 'b')
    expect(box.value).toBe('**hello**')
    /* The selection moved with the marks, which is what the box is told to
       do after wrapping - so the second press acts on the same word. */
    select(box, 2, 7)
    press(box, 'i')
    expect(box.value).toBe('***hello***')
  })

  it('and pressing the same one twice takes it off again', () => {
    const el = mount(<Composer name="general" kind="text" onSend={vi.fn()} />)
    const box = type(el, 'hello') as HTMLTextAreaElement
    select(box, 0, 5)
    press(box, 'b')
    select(box, 2, 7)
    press(box, 'b')
    expect(box.value).toBe('hello')
  })
})

/**
 * A message that could not be sent stays in the box.
 *
 * Found auditing failure modes. Messages go over the gateway socket, and a
 * socket that is not open drops what it is handed. The box was cleared the
 * moment the text was passed on, whether it went or not - so a wifi blip, a
 * sleeping laptop or a restart of the server mid-sentence took the words and
 * said nothing, which for a chat app is the worst thing that can happen
 * quietly.
 */
describe('when the message does not go', () => {
  it('keeps the words rather than clearing the box', () => {
    const el = mount(<Composer name="general" kind="text" onSend={() => false} />)
    const box = type(el, 'the words somebody typed')
    enter(box)

    expect(box.value, 'the box was emptied and the words are gone')
      .toBe('the words somebody typed')
  })

  /* And says so, because a box that stays full otherwise reads as a key that
     did not register. */
  it('and says that it did not go', () => {
    const el = mount(<Composer name="general" kind="text" onSend={() => false} />)
    enter(type(el, 'words'))
    expect(el.textContent ?? '').toMatch(/did not send/i)
  })

  /* And clears it when it went, which is every ordinary message. */
  it('but clears it when it went', () => {
    const el = mount(<Composer name="general" kind="text" onSend={() => true} />)
    const box = type(el, 'this one goes')
    enter(box)
    expect(box.value, 'the box kept the words after a good send').toBe('')
  })

  /*
   * And an older caller that returns nothing is not treated as a failure.
   *
   * Only `false` counts. Several things still hand this a function that
   * returns undefined, and reading that as a drop would leave the box full
   * after every message.
   */
  it('and treats a caller that says nothing as a send', () => {
    const el = mount(<Composer name="general" kind="text" onSend={() => undefined} />)
    const box = type(el, 'quiet caller')
    enter(box)
    expect(box.value).toBe('')
  })
})
