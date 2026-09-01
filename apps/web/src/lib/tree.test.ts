import { describe, expect, it } from 'vitest'
import { moved, sectionsOf } from './tree'
import type { Category, ServerChannel } from './wire'

/* A room in a server, which is what every one of these is. Typed as such
   rather than as "a channel", so that an override which would make it a
   conversation - a null server, a kind of 'dm' - is refused here rather than
   producing a shape the app can never receive. */
const chan = (id: string, over: Partial<ServerChannel> = {}): ServerChannel => ({
  id, space_id: 's1', name: id, kind: 'text', topic: '', position: 0,
  category_id: null, ...over,
})

const cat = (id: string, position: number, over: Partial<Category> = {}): Category => ({
  id, space_id: 's1', name: id, position, ...over,
} as Category)

describe('the channel list, in sections', () => {
  /*
   * Drawn as one flat run sorted by position, a server that had arranged its
   * rooms into categories showed them jumbled together and its categories
   * were invisible.
   */
  it('puts each channel under its own heading', () => {
    const out = sectionsOf(
      [chan('a', { category_id: 'c1' }), chan('b', { category_id: 'c2' })],
      [cat('c1', 0), cat('c2', 1)],
      's1', undefined,
    )
    expect(out.map((s) => s.label)).toEqual(['c1', 'c2'])
    expect(out[0]?.channels.map((c) => c.id)).toEqual(['a'])
  })

  /* Text and Voice are headings too, holding whatever nobody has filed —
     without them a channel in no category is in no section, and vanishes. */
  it('and keeps unfiled channels under Text and Voice', () => {
    const out = sectionsOf(
      [chan('a'), chan('v', { kind: 'voice' })],
      [], 's1', undefined,
    )
    expect(out.map((s) => s.label)).toEqual(['Text', 'Voice'])
    expect(out[1]?.channels.map((c) => c.id)).toEqual(['v'])
  })

  /*
   * Their place comes from the space rather than from a category row, because
   * they are not categories — read as zero they would always sit at the top,
   * whatever somebody had dragged them to.
   */
  it('and puts those two where the server says', () => {
    const both = (loose: { text: number; voice: number }) => sectionsOf(
      [chan('a'), chan('x', { category_id: 'Zed' })],
      [cat('Zed', 4)],
      's1', loose,
    ).map((s) => s.label)

    /* Asked both ways round, with a heading whose name sorts *after* Text
       either way — so the order can only have come from the numbers. The
       first version of this used a category named "c1", which sorts before
       "Text" whichever position it had, and passed with the placement
       ignored entirely. */
    expect(both({ text: 9, voice: 10 })).toEqual(['Zed', 'Text'])
    expect(both({ text: 1, voice: 2 })).toEqual(['Text', 'Zed'])
  })

  /* A heading with nothing under it reads as a room somebody cannot see
     rather than as a category nobody has used yet. */
  it('and leaves out a heading with nothing under it', () => {
    const out = sectionsOf([chan('a')], [cat('empty', 9)], 's1', undefined)
    expect(out.map((s) => s.label)).toEqual(['Text'])
  })

  /*
   * And kept for somebody who can put something in it.
   *
   * They have just made it. A category that only appears once a channel is
   * in it is a button that does nothing: nowhere to drop a channel, and no
   * sign the thing was created at all.
   */
  it('and keeps one for whoever can move channels into it', () => {
    const out = sectionsOf([chan('a')], [cat('empty', 9)], 's1', undefined, true)
    expect(out.map((s) => s.label)).toContain('empty')
  })

  /* The unfiled ones are not categories anybody made, so they still go. */
  it('but not an empty Text or Voice heading', () => {
    const out = sectionsOf([], [cat('empty', 9)], 's1', undefined, true)
    expect(out.map((s) => s.label)).toEqual(['empty'])
  })

  /* A category belongs to one server, and so does a channel — this is the
     shape of every cross-server leak in this app. */
  it('and never a channel from somewhere else', () => {
    const out = sectionsOf(
      [chan('a'), { ...chan('b'), space_id: 's2' }],
      [], 's1', undefined,
    )
    expect(out.flatMap((s) => s.channels.map((c) => c.id))).toEqual(['a'])
  })

  /*
   * And never another server's category, even when a channel here points at
   * one. That is the shape of every cross-server leak in this app — and the
   * first version of this test proved nothing, because the foreign category
   * had no channels under it and was dropped for being empty rather than for
   * belonging elsewhere.
   */
  it('and never another server’s category, even one a channel names', () => {
    const out = sectionsOf(
      [chan('a', { category_id: 'theirs' })],
      [{ ...cat('theirs', 0), space_id: 's2' }],
      's1', undefined,
    )
    expect(out.map((s) => s.label)).not.toContain('theirs')
  })

  /*
   * The failure this is really about: a channel filed under a heading the
   * client does not have was in no section at all, and simply was not drawn.
   * One server's headings replacing another's - which is how it happened -
   * emptied a whole server, with nothing on screen to say a room was missing.
   */
  it('and never loses a channel whose heading is missing', () => {
    const out = sectionsOf([chan('a', { category_id: 'gone' })], [], 's1', undefined)
    expect(out.flatMap((sec) => sec.channels.map((c) => c.id))).toEqual(['a'])
    expect(out[0]?.label, 'it falls back to unfiled').toBe('Text')
  })

  it('and files it properly again once the heading arrives', () => {
    const out = sectionsOf(
      [chan('a', { category_id: 'c1' })], [cat('c1', 0)], 's1', undefined,
    )
    expect(out.map((sec) => sec.label)).toEqual(['c1'])
  })

  it('and orders channels within a heading by position', () => {
    const out = sectionsOf(
      [chan('late', { position: 5 }), chan('early', { position: 1 })],
      [], 's1', undefined,
    )
    expect(out[0]?.channels.map((c) => c.id)).toEqual(['early', 'late'])
  })
})

describe('moving one', () => {
  const order = ['a', 'b', 'c']

  it('swaps it with its neighbour', () => {
    expect(moved(order, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moved(order, 'b', 1)).toEqual(['a', 'c', 'b'])
  })

  /* Off either end is not a move. Wrapping puts the top one at the bottom,
     which is not what anybody pressing "up" is asking for. */
  it('and off the end is not a move', () => {
    expect(moved(order, 'a', -1)).toEqual(order)
    expect(moved(order, 'c', 1)).toEqual(order)
  })

  it('and something not in the list leaves it alone', () => {
    expect(moved(order, 'z', 1)).toEqual(order)
  })

  /* The whole list goes, not a moved id and a destination — two people
     reordering at once both send what they are looking at, and the second
     wins entirely rather than landing half inside the first one's list. */
  it('and always answers with the whole list', () => {
    expect(moved(order, 'b', -1)).toHaveLength(order.length)
  })
})
