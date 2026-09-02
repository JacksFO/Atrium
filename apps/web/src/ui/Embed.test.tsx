import { act } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Embeds } from './Embed'
import type { Api } from '../lib/api'
import type { Preview } from '../lib/previews'

/**
 * The picture on a link preview opens like every other picture.
 *
 * Reported with a screenshot: a friend posted a link, the card came back with
 * a map on it, and clicking the map did nothing. A card's picture is cropped
 * to the card's width and 300 pixels tall, so for the thing somebody was
 * actually sent - a map, a screenshot, a chart - it is a thumbnail of it and
 * not a look at it. The picture attached to a message opens, and a picture
 * somebody links on its own opens; this was the one that did not, and a
 * picture that does nothing when clicked reads as broken rather than as small
 * on purpose.
 *
 * Mounted and clicked rather than read, because what is being pinned is what
 * happens when somebody presses it. What this cannot show is whether anything
 * lies over the button - there is no layout in jsdom - but the card has
 * nothing positioned above the picture, and the video branch that does is a
 * different one.
 */

const CARD: Preview = {
  url: 'https://x.com/someone/status/1', title: 'Tarkov GPS', description: 'a tool',
  image: 'https://pbs.example/preview.png', site: 'X (formerly Twitter)',
  video: '', videoType: '', videoWidth: 0, videoHeight: 0, accent: '',
}

/* The picture is normally fetched through our own server, which is a request
   nothing here should be making. The address is handed straight back so the
   component has something to draw. */
vi.mock('./useProxiedImage', () => ({
  useProxiedImage: (_server: unknown, url: string, want = true) =>
    (url && want ? { src: `proxied:${url}`, failed: false } : { src: '', failed: false }),
}))

vi.mock('../lib/previews', async (real) => {
  const actual = await real<typeof import('../lib/previews')>()
  return { ...actual, previewOf: async (): Promise<Preview> => CARD }
})

let root: Root | null = null
let host: HTMLDivElement | null = null
async function draw(node: React.ReactElement): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(node) })
  /* The card is fetched, so it is not there on the first pass. */
  await act(async () => { await Promise.resolve() })
  return host
}
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.querySelectorAll('.lightbox').forEach((n) => n.remove())
})

const server = {} as Api
const press = (el: Element): void => {
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

describe("a preview card's picture", () => {
  const card = (): Promise<HTMLDivElement> =>
    draw(<Embeds server={server} body="look at https://x.com/someone/status/1" on />)

  it('is drawn on the card', async () => {
    const el = await card()
    /* The precondition. Without it, "no lightbox" below would pass on a run
       where the card never rendered at all. */
    expect(el.querySelector('.embed'), 'no card was drawn').not.toBeNull()
    expect(el.querySelector('.emedia img'), 'no picture on the card').not.toBeNull()
  })

  it('and opens when it is pressed', async () => {
    const el = await card()
    expect(document.querySelector('.lightbox'), 'open before anybody pressed it').toBeNull()

    const picture = el.querySelector('.emedia')
    expect(picture, 'there is nothing to press').not.toBeNull()
    press(picture!)

    expect(document.querySelector('.lightbox'), 'pressing it did nothing').not.toBeNull()
  })

  /*
   * A button, so it is reachable by keyboard and reads as a control. A div
   * with a click on it looks identical and is neither.
   */
  it('and is a button, not a picture with a handler', async () => {
    const el = await card()
    expect(el.querySelector('button.emedia')).not.toBeNull()
  })

  /*
   * And says what it is.
   *
   * A button whose only content is a picture with no alt is announced as
   * "button" and nothing else. An attached picture is named after its file;
   * this one takes the name of the card it sits on, which is the sentence
   * somebody just read above it.
   */
  it('and carries a name, the way an attached picture does', async () => {
    const el = await card()
    const picture = el.querySelector('.emedia img')!
    expect(picture.getAttribute('alt')).toBe(CARD.title)
  })

  /* Including once it is open - the big one is the same picture. */
  it('and keeps that name when it opens', async () => {
    const el = await card()
    press(el.querySelector('.emedia')!)
    const big = document.querySelector('.lightbox img')
    expect(big, 'nothing opened').not.toBeNull()
    expect(big!.getAttribute('alt')).toBe(CARD.title)
  })

  /* And does not take somebody off to the site instead. The card's link is
     its title, which is a different thing to press. */
  it('and does not carry a link of its own', async () => {
    const el = await card()
    const picture = el.querySelector('.emedia')!
    expect(picture.closest('a'), 'the picture is inside a link').toBeNull()
    expect(el.querySelector('a.etitle'), 'the title stopped being a link').not.toBeNull()
  })
})

describe('a picture somebody links on its own', () => {
  /* Unchanged, and here so the two cannot drift apart: this one has opened
     since it was built, and it is the shape the card's picture now matches. */
  it('still opens the same way', async () => {
    const el = await draw(
      <Embeds server={server} body="https://example.com/thing.png" on />,
    )
    const picture = el.querySelector('button.bareimg')
    expect(picture, 'the linked picture stopped being a button').not.toBeNull()
    press(picture!)
    expect(document.querySelector('.lightbox')).not.toBeNull()
  })
})

describe('the stylesheet', () => {
  const css = readFileSync(join(__dirname, '../app.css'), 'utf8')

  /*
   * The rule for the picture inside the button was already in the stylesheet
   * and matched nothing, because the markup put the class on the img itself.
   * Both halves are load-bearing now.
   */
  it('dresses the button and the picture in it', () => {
    expect(css).toMatch(/\.embed \.emedia\{/)
    expect(css).toMatch(/\.embed \.emedia img\{/)
  })

  /* The same pointer as the other two, or one of three identical-looking
     pictures behaves differently for no visible reason. */
  it('and says it can be opened, the way the others do', () => {
    const ruleFor = (sel: string): string => {
      const at = css.indexOf(sel)
      expect(at, `${sel} is not in the stylesheet`).toBeGreaterThan(-1)
      return css.slice(at, css.indexOf('}', at))
    }
    expect(ruleFor('.embed .emedia{')).toContain('cursor:zoom-in')
    expect(ruleFor('.bareimg{')).toContain('cursor:zoom-in')
  })
})
