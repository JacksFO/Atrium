import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isWatching, onAttentionChange, watchAttention } from './attention'

/**
 * Whether anybody is actually looking at this window.
 *
 * visibilityState on its own is not enough, and this is the whole reason the
 * file exists: it reports "visible" for a window on a second monitor that
 * nobody is looking at, which is exactly the case worth catching. hasFocus()
 * is the other half.
 */

const look = (visible: boolean, focused: boolean) => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(
    visible ? 'visible' : 'hidden',
  )
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused)
}

afterEach(() => { vi.restoreAllMocks() })

describe('what counts as being looked at', () => {
  it('is visible and focused together', () => {
    look(true, true)
    expect(isWatching()).toBe(true)
  })

  it('and a hidden tab is not', () => {
    look(false, true)
    expect(isWatching()).toBe(false)
  })

  /* The case the whole file is for: a second monitor. */
  it('and neither is a window nobody is looking at', () => {
    look(true, false)
    expect(isWatching()).toBe(false)
  })
})

describe('saying so', () => {
  it('writes it where the stylesheet can read it', () => {
    look(true, false)
    watchAttention()
    window.dispatchEvent(new Event('blur'))
    expect(document.documentElement.dataset.watching).toBe('no')

    look(true, true)
    window.dispatchEvent(new Event('focus'))
    expect(document.documentElement.dataset.watching).toBe('yes')
  })

  /* And to anything that has to act rather than restyle: CSS can pause an
     animation but it cannot pause a video. */
  it('and tells whoever asked to be told', () => {
    const told = vi.fn()
    const off = onAttentionChange(told)
    look(true, false)
    window.dispatchEvent(new Event('blur'))
    expect(told).toHaveBeenCalledWith(false)
    off()
    told.mockClear()
    window.dispatchEvent(new Event('focus'))
    expect(told).not.toHaveBeenCalled()
  })
})

describe('what stops while nobody is looking', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

  it('is every animation, paused rather than removed', () => {
    expect(css).toMatch(/\[data-watching="no"\][^{]*\{[^}]*animation-play-state:paused/)
  })

  /* Paused, so it is mid-way through where it was when they come back rather
     than snapping to the start. */
  it('and there are animations for it to stop', () => {
    expect((css.match(/animation:/g) ?? []).length).toBeGreaterThan(10)
  })
})

describe('the picture of your own screen', () => {
  const stage = readFileSync(resolve(process.cwd(), 'src/ui/Stage.tsx'), 'utf8')

  it('stops while you are looking elsewhere', () => {
    expect(stage).toContain('onAttentionChange')
    expect(stage).toMatch(/if \(mine && !looking\) v\.pause\(\)/)
  })

  /* Other people's keep playing — they are why the call exists, and pausing
     them would pause the thing somebody tabbed away to listen to. */
  it('and only yours', () => {
    expect(stage).not.toMatch(/if \(!looking\) v\.pause\(\)/)
  })
})

/**
 * Pictures somebody chose, which hold still when nobody is looking.
 *
 * Pausing an animation is a CSS property; pausing a GIF is not — there is no
 * property for it, so an animated avatar kept decoding frames in a window
 * nobody was looking at, and a member list is thirty of them. The first frame
 * is drawn to a canvas and shown instead.
 */
describe('an animated picture', () => {
  const still = readFileSync(resolve(process.cwd(), 'src/lib/stillframe.ts'), 'utf8')

  it('is only worked on when it could animate at all', () => {
    /* Most pictures cannot, and they get no listener, no canvas and no
       second render. */
    expect(still).toContain('canAnimate')
  })

  it('and every picture the app draws goes through the one component', () => {
    for (const f of ['src/ui/Avatar.tsx', 'src/ui/Profile.tsx', 'src/ui/Shell.tsx']) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8')
      expect(src, f).toContain('<Still')
    }
  })

  /* Avatars, banners and server icons are the same upload route and the same
     problem — anything showing a picture from this server goes through it
     rather than waiting to be the next report. */
  it('and none of them is a bare img of a stored path any more', () => {
    for (const f of ['src/ui/Avatar.tsx', 'src/ui/Profile.tsx', 'src/ui/Shell.tsx']) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8')
      expect(src, f).not.toMatch(/<img[^>]*src=\{(?:user|me|them|s|space)\.[a-z_]*path\}/)
    }
  })
})

describe('your own preview, while you look elsewhere', () => {
  const stage = readFileSync(resolve(process.cwd(), 'src/ui/Stage.tsx'), 'utf8')

  /* A frozen picture with no explanation is indistinguishable from a share
     that has died, and the person most likely to worry is the one sharing. */
  it('says it is paused rather than looking like a stall', () => {
    expect(stage).toMatch(/mine && !looking && asked && stream/)
    /* The reassurance first: what somebody seeing a frozen picture of their
       own screen wants to know is whether the people watching still see it. */
    expect(stage).toContain('Your stream is still running')
    expect(stage).toContain('paused while you are looking elsewhere')
  })
})

/**
 * Nothing keeps working for a window nobody is looking at.
 *
 * Five animations here never stop on their own — a marquee, a bobbing arrow,
 * the pulsing rings on somebody speaking, the update bar, and a name's
 * shimmer. Each of them keeps a compositor awake, and the machine is usually
 * busy with whatever somebody IS looking at.
 */
describe('what runs while nobody is looking', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')
  const app = readFileSync(resolve(process.cwd(), 'src/ui/App.tsx'), 'utf8')

  it('is no animation, including the ones on pseudo-elements', () => {
    /* The rings and the bar are drawn on ::before and ::after, so a rule
       naming only `*` would leave exactly the ones that never stop. */
    for (const sel of ['*', '*::before', '*::after']) {
      expect(css, sel).toContain(`[data-watching="no"] ${sel}`)
    }
  })

  /*
   * Except the ones somebody reads rather than looks at. A stopped ring on a
   * second monitor does not say "paused", it says nobody is talking.
   */
  it('except the ones that are information', () => {
    expect(css).toMatch(/\[data-watching="no"\] \.vhud \.dot,/)
    expect(css).toContain('animation-play-state:running!important')
  })

  it('and every animation that never ends is one of them', () => {
    const endless = [...css.matchAll(/animation:([a-zA-Z-]+)[^;}]*infinite/g)].map((m) => m[1])
    expect(endless.length).toBeGreaterThan(3)
    /* Nothing opts out: the rule is on the universal selector with !important
       precisely so a later rule cannot quietly exempt one. */
    expect(css).toContain('animation-play-state:paused!important')
  })

  /* And no asking the server questions nobody will read the answer to. */
  it('and no polling for a newer build', () => {
    const at = app.indexOf('const ask = ')
    expect(at).toBeGreaterThan(0)
    expect(app.slice(at, at + 400)).toContain('if (!isWatching()) return')
  })

  /* But the answer is caught up on when somebody comes back, rather than
     waiting out the rest of the interval. */
  it('and it catches up on the way back', () => {
    expect(app).toMatch(/onAttentionChange\(\(watching\) => \{ if \(watching\) ask\(\) \}\)/)
  })
})
