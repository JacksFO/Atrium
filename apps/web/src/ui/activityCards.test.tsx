import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityCards, ActivityLine } from './Activity'
import { stamp } from '../lib/activity'
import type { Activity } from '../lib/wire'

/**
 * What somebody is doing, drawn.
 *
 * The data has flowed since the pump was reconnected; this is the shape it is
 * shown in. One line in a list of names, where the verb is quiet and the
 * thing carries the weight, and a card on a profile with the picture, the
 * artist and where the track has got to.
 */

const game: Activity = { kind: 'game', name: 'Escape from Tarkov', since: Date.now() - 499_000 }
const music: Activity = {
  kind: 'music', name: 'I am Not Alone', detail: 'Calvin Harris',
  at: 63_000, length: 226_000, art: 'abc123',
}

let root: Root | null = null
let host: HTMLDivElement | null = null
function draw(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(node) })
  return host
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })

describe('the line under a name', () => {
  it('names the game when there is one', () => {
    const el = draw(<ActivityLine activity={game} />)
    expect(el.textContent).toContain('Playing')
    expect(el.textContent).toContain('Escape from Tarkov')
  })

  /* Everybody's music says the same thing, so the player is what is named. */
  it('and names the player for music', () => {
    const el = draw(<ActivityLine activity={music} />)
    expect(el.textContent).toContain('Listening to')
    expect(el.textContent).toContain('Spotify')
  })

  /* The thing itself is what somebody scans for, so it is the bold half. */
  it('and puts the weight on the thing, not the verb', () => {
    const el = draw(<ActivityLine activity={game} />)
    expect(el.querySelector('b')?.textContent).toBe('Escape from Tarkov')
  })

  it('and draws nothing when they are doing nothing', () => {
    const el = draw(<ActivityLine activity={null} />)
    expect(el.textContent).toBe('')
  })
})

describe('the cards on a profile', () => {
  const heard = (list: Activity[]) => stamp(list)

  /* Always that order, so two profiles do not disagree about which comes
     first depending on which arrived first. */
  it('put the game above the music', () => {
    const el = draw(<ActivityCards heard={heard([music, game])} ran={0} />)
    const headings = [...el.querySelectorAll('.act-h')].map((h) => h.textContent)
    expect(headings).toEqual(['Playing a game', 'Listening to Spotify'])
  })

  it('and show the track, the artist and both times', () => {
    const el = draw(<ActivityCards heard={heard([music])} ran={0} />)
    expect(el.textContent).toContain('I am Not Alone')
    expect(el.textContent).toContain('by Calvin Harris')
    expect(el.textContent).toContain('1:03')
    expect(el.textContent).toContain('3:46')
  })

  /* The bar moves with the time since the player last said, not only when a
     new report arrives - otherwise it sits where it was left. */
  it('and the bar is where the track has got to', () => {
    const el = draw(<ActivityCards heard={heard([music])} ran={0} />)
    const fill = el.querySelector('.act-bar > span') as HTMLElement
    expect(parseFloat(fill.style.width)).toBeCloseTo(27.9, 0)

    act(() => { root!.render(<ActivityCards heard={heard([music])} ran={60_000} />) })
    const later = el.querySelector('.act-bar > span') as HTMLElement
    expect(parseFloat(later.style.width)).toBeGreaterThan(50)
  })

  /* A player reporting a position and no length would draw a bar filled to
     some fraction of nothing, which is a lie rather than a gap. */
  it('and no bar at all when there is nothing honest to draw', () => {
    const noLength = heard([{ kind: 'music', name: 'x', at: 1000 } as Activity])
    const el = draw(<ActivityCards heard={noLength} ran={0} />)
    expect(el.querySelector('.act-bar')).toBeNull()
  })

  it('and how long a game has been running', () => {
    const el = draw(<ActivityCards heard={heard([game])} ran={0} />)
    expect(el.textContent).toMatch(/08:1\d elapsed/)
  })

  it('and nothing when there is nothing', () => {
    const el = draw(<ActivityCards heard={[]} ran={0} />)
    expect(el.textContent).toBe('')
  })
})

describe('the clock behind them', () => {
  const hook = readFileSync(resolve(process.cwd(), 'src/ui/useHeard.ts'), 'utf8')

  /* A profile nobody can see is a free interval to not run. */
  it('does not tick while the window is not being looked at', () => {
    expect(hook).toContain('if (!watching || held.current.length === 0) return')
    expect(hook).toContain('onAttentionChange')
  })

  /* Closing a profile and opening it again must not start the count from
     nothing and show 0:00 forty seconds into a song. */
  it('and remembers when each was first heard, across a reopen', () => {
    expect(hook).toContain('stamp(orderedActivities(activities), held.current)')
  })
})
