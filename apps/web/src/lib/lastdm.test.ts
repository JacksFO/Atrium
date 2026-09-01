import { beforeEach, describe, expect, it } from 'vitest'
import { forgetSpot, lastSpot, rememberSpot } from './lastdm'

/**
 * Where you were, for the button that comes back here.
 *
 * The rail's home button always went to the greeting. Right once - the first
 * time, when there is nothing to go back to - and wrong every time after,
 * because clicking away to a server and back is going back to what you were
 * reading.
 *
 * Then it remembered only conversations, which is wrong the other way: the
 * home side is three things, and coming back to it should be coming back to
 * whichever one you left. Reported as the home button always going to the
 * last DM even when the last thing on screen was the friends list.
 */
describe('where to come back to', () => {
  beforeEach(() => { localStorage.clear() })

  it('is nothing before you have been anywhere', () => {
    expect(lastSpot()).toBeNull()
  })

  it('is the last conversation opened', () => {
    rememberSpot({ kind: 'dm', channelId: 'dm1' })
    rememberSpot({ kind: 'dm', channelId: 'dm2' })
    expect(lastSpot()).toEqual({ kind: 'dm', channelId: 'dm2' })
  })

  /* The two that were being thrown away. */
  it('or the friends list, if that is what was left open', () => {
    rememberSpot({ kind: 'page', page: 'friends' })
    expect(lastSpot()).toEqual({ kind: 'page', page: 'friends' })
  })

  it('or the greeting itself', () => {
    rememberSpot({ kind: 'page', page: 'home' })
    expect(lastSpot()).toEqual({ kind: 'page', page: 'home' })
  })

  /* And the later one wins whichever kind it is, or leaving a conversation
     for the friends list would still come back to the conversation. */
  it('and the most recent wins, across kinds', () => {
    rememberSpot({ kind: 'dm', channelId: 'dm1' })
    rememberSpot({ kind: 'page', page: 'friends' })
    expect(lastSpot()).toEqual({ kind: 'page', page: 'friends' })
    rememberSpot({ kind: 'dm', channelId: 'dm1' })
    expect(lastSpot()).toEqual({ kind: 'dm', channelId: 'dm1' })
  })

  it('survives a reload, which is when it matters', () => {
    /* Shipping an update to this app means reloading the page, so anything
       held only in memory is lost exactly when somebody notices. */
    rememberSpot({ kind: 'dm', channelId: 'dm1' })
    expect(lastSpot()).toEqual({ kind: 'dm', channelId: 'dm1' })
  })

  it('is forgotten when there is nothing to go back to', () => {
    rememberSpot({ kind: 'dm', channelId: 'dm1' })
    forgetSpot()
    expect(lastSpot()).toBeNull()
  })

  it('and goes stale rather than following you around', () => {
    /* A day old is not a fact about where you are now. */
    localStorage.setItem('atrium.lastdm', JSON.stringify({
      kind: 'dm', channelId: 'dm1', at: Date.now() - 25 * 60 * 60_000,
    }))
    expect(lastSpot()).toBeNull()
  })

  /*
   * What was written before this knew about pages: a channel and a time, and
   * no kind at all. Still read as the conversation it is, because the
   * alternative is everybody with the app open losing their place the moment
   * this ships - and the key is deliberately the one it always was.
   */
  it('and still reads what the old version wrote', () => {
    localStorage.setItem('atrium.lastdm', JSON.stringify({
      channelId: 'dm-from-before', at: Date.now(),
    }))
    expect(lastSpot()).toEqual({ kind: 'dm', channelId: 'dm-from-before' })
  })

  it('and nonsense in storage is no answer, not a crash', () => {
    localStorage.setItem('atrium.lastdm', 'not json')
    expect(lastSpot()).toBeNull()
    localStorage.setItem('atrium.lastdm', JSON.stringify({ kind: 'page', page: 'nowhere', at: Date.now() }))
    expect(lastSpot(), 'a page this app does not have').toBeNull()
  })
})
