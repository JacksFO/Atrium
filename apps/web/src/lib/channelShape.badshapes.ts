import type { Channel } from './wire'

/*
 * The shapes the old type allowed and this one refuses.
 *
 * Not a test that runs - a file that must not compile without each of these
 * marks. If any of the three ever becomes legal again, `tsc` fails on the
 * unused @ts-expect-error, which is the whole point: the guarantee is a
 * compile-time one and this is where it is checked.
 */

// @ts-expect-error a conversation cannot carry a server
export const dmWithServer: Channel = {
  id: 'x', space_id: 's1', name: '', kind: 'dm', topic: '',
  category_id: null, position: 0,
}

// @ts-expect-error a room in a server must have one
export const roomWithoutServer: Channel = {
  id: 'y', space_id: null, name: 'general', kind: 'text', topic: '',
  category_id: null, position: 0,
}

// @ts-expect-error a conversation cannot sit under a heading
export const dmInCategory: Channel = {
  id: 'z', space_id: null, name: '', kind: 'dm', topic: '',
  category_id: 'cat1', position: 0,
}
