import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Report, REPORT_MAX } from './Report'
import type { Api } from '../lib/api'

/**
 * The button in the corner, the two things it offers, and the form behind
 * each. What is written here goes to the server and stays there - no screen
 * in the app can ask for it back, so there is nothing else to test about
 * where it ends up.
 */

let root: Root | null = null
let host: HTMLDivElement | null = null
let sent: Array<[string, unknown]> = []

const api = (answer: unknown = { ok: true }): Api => ({
  post: (path: string, body: unknown) => { sent.push([path, body]); return Promise.resolve(answer) },
}) as unknown as Api

function draw(server: Api = api()): HTMLDivElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root!.render(<Report server={server} />) })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  document.querySelectorAll('.ctx,.ctxscrim,.modal,.scrim').forEach((n) => n.remove())
  root = null
  host = null
  sent = []
})

const button = (el: HTMLElement) => el.querySelector('.reportb') as HTMLButtonElement
const rows = () => [...document.querySelectorAll('.ctx .mitem')]
const box = () => document.querySelector('textarea') as HTMLTextAreaElement | null
const action = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)

function type(text: string) {
  const t = box()!
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value',
  )!.set!
  act(() => {
    setter.call(t, text)
    t.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('the button', () => {
  it('is always there, and says what it is for', () => {
    const el = draw()
    expect(button(el)).not.toBe(null)
    expect(button(el).getAttribute('aria-label')).toBe('Send feedback or report a bug')
  })

  it('offers the two kinds, and nothing else', () => {
    const el = draw()
    act(() => { button(el).click() })
    expect(rows().map((r) => r.textContent)).toEqual(['Feedback', 'Bugs & issues'])
  })
})

describe('the form', () => {
  const open = (which: number) => {
    const el = draw()
    act(() => { button(el).click() })
    act(() => { (rows()[which] as HTMLButtonElement).click() })
    return el
  }

  it('asks a different question for each kind', () => {
    open(0)
    expect(document.body.textContent).toContain('What would make this better?')
  })

  it('and for a bug, asks what happened', () => {
    open(1)
    expect(document.body.textContent).toContain('what did you expect instead?')
  })

  it('will not send an empty report', () => {
    open(0)
    expect(action('Send')?.disabled).toBe(true)
  })

  it('sends what was typed, with which kind it is', () => {
    open(1)
    type('the mute button does nothing')
    act(() => { action('Send')!.click() })
    expect(sent).toHaveLength(1)
    const [path, body] = sent[0]!
    expect(path).toBe('/api/feedback')
    expect(body).toMatchObject({ kind: 'bug', text: 'the mute button does nothing' })
  })

  it('and says which build it came from, which nobody remembers to', () => {
    open(0)
    type('a thought')
    act(() => { action('Send')!.click() })
    expect(sent[0]![1]).toHaveProperty('platform')
    expect(sent[0]![1]).toHaveProperty('desktop')
  })

  it('but nothing about where they were or what was said', () => {
    /* A report is about the app. It is not a way to send us a conversation. */
    open(0)
    type('a thought')
    act(() => { action('Send')!.click() })
    expect(Object.keys(sent[0]![1] as object).sort())
      .toEqual(['desktop', 'kind', 'platform', 'text', 'version'])
  })
})

describe('how much can be said', () => {
  const open = () => {
    const el = draw()
    act(() => { button(el).click() })
    act(() => { (rows()[0] as HTMLButtonElement).click() })
    return el
  }

  it('counts down from the limit', () => {
    open()
    expect(document.querySelector('.reportleft')?.textContent).toBe(String(REPORT_MAX))
    type('hello')
    expect(document.querySelector('.reportleft')?.textContent).toBe(String(REPORT_MAX - 5))
  })

  it('and refuses to take more than that', () => {
    /* Cut where it is typed as well as refused at the server, so nobody
       writes three paragraphs and is told afterwards. */
    open()
    type('x'.repeat(REPORT_MAX + 50))
    expect(box()!.value.length).toBe(REPORT_MAX)
  })

  it('warning when there is little room left', () => {
    open()
    type('x'.repeat(REPORT_MAX - 5))
    expect(document.querySelector('.reportleft')?.className).toContain('low')
  })
})

describe('when it will not send', () => {
  it('says why, and keeps what was typed', async () => {
    const el = draw(api({ error: 'that is a lot of reports - try again shortly' }))
    act(() => { button(el).click() })
    act(() => { (rows()[0] as HTMLButtonElement).click() })
    type('a thought')
    await act(async () => { action('Send')!.click(); await Promise.resolve() })
    expect(document.body.textContent).toContain('that is a lot of reports')
    expect(box()!.value, 'still there to try again').toBe('a thought')
  })
})

describe('a refusal from the network', () => {
  it('is said rather than swallowed', async () => {
    const failing = { post: () => Promise.reject(new Error('offline')) } as unknown as Api
    const el = draw(failing)
    act(() => { button(el).click() })
    act(() => { (rows()[0] as HTMLButtonElement).click() })
    type('a thought')
    await act(async () => { action('Send')!.click(); await Promise.resolve() })
    expect(document.body.textContent).toContain('offline')
  })
})

describe('nothing leaks', () => {
  /*
   * Reports are about the app and sometimes about the people in it, so the
   * server has no route that hands them back: nothing in the client can ask
   * for them, whoever is signed in. Said here because it is the sort of
   * convenience somebody adds later without noticing what it opens.
   */
  it('and the server offers no way to read them back', () => {
    const route = readFileSync(
      join(__dirname, '..', '..', '..', 'server', 'src', 'routes', 'feedback.ts'), 'utf8',
    )
    expect(route).toContain("app.post('/api/feedback'")
    expect(route, 'a GET would put reports behind a URL').not.toMatch(/app\.get\(/)
  })
})
