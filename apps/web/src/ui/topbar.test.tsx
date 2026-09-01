import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TopBar } from './TopBar'

/**
 * The bar you move the window by.
 *
 * In the desktop build this strip is the window's drag region - there is
 * nothing else to take hold of, because the app draws its own chrome. The
 * inner element is absolutely positioned at inset 0, so it covers the whole
 * bar, and it was marked no-drag: the drag region underneath was cancelled
 * completely and the window could not be moved at all.
 *
 * The reasoning behind that no-drag was sound and about a different kind of
 * element. Everything inside a drag region is handed to the window manager
 * before the page sees it, so anything clickable does need it - but there is
 * nothing clickable in here, only a server name and a channel name.
 */

const src = readFileSync(resolve(process.cwd(), 'src/ui/TopBar.tsx'), 'utf8')
const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

describe('the top bar', () => {
  it('says where you are', () => {
    const html = renderToStaticMarkup(
      <TopBar server={{ post: async () => ({}) } as never} space={{ name: 'Somewhere', icon_path: null }} channel="general" kind="text" />,
    )
    expect(html).toContain('Somewhere')
    expect(html).toContain('general')
  })

  /* The whole reason it exists in the desktop build. */
  it('and is a drag region', () => {
    const rule = css.slice(css.indexOf('.topbar{'), css.indexOf('}', css.indexOf('.topbar{')))
    expect(rule).toContain('-webkit-app-region:drag')
  })

  /*
   * Nothing inside it may cancel that. The inner element covers the whole bar,
   * so a no-drag on it is a no-drag on all of it.
   */
  it('and nothing inside it cancels the drag', () => {
    /* Comments first: this file's own explanation of the bug names the thing
       it is looking for, and so does the component's. A scanner that reads
       its own prose finds the fault in the description of the fault. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(new RegExp('//[^' + String.fromCharCode(10) + ']*', 'g'), '')
    expect(code).not.toContain('no-drag')
    expect(code).not.toContain('WebkitAppRegion')
  })

  /* It has to be tall enough to take hold of. */
  it('and has a height even where the window manager reports none', () => {
    expect(css).toContain('--topbar-h:max(')
  })
})
