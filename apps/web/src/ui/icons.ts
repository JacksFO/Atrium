/**
 * The icons, as data rather than as markup.
 *
 * The old client kept each one as a string of SVG and dropped it into the
 * page. That works, and it is also the one habit that makes an injection
 * possible — so there is no string of markup here and no
 * dangerouslySetInnerHTML anywhere in this app. Each icon is the shapes it
 * is made of, and the component below turns them into elements.
 *
 * Generated from the client this replaces rather than retyped, because
 * transcribing 58 sets of path data by hand is how one of them ends up
 * subtly wrong and nobody notices for a month.
 */

export type Shape = { t: 'path' | 'circle' | 'rect' } & Record<string, string>

export const ICONS = {
  hash: [{"t": "path", "d": "M9 3L7 21M17 3l-2 18M4 8.5h16M3 15.5h16"}],
  vol: [{"t": "path", "d": "M11 5L6 9H3v6h3l5 4V5z"}, {"t": "path", "d": "M15.5 9.5a3.5 3.5 0 010 5"}, {"t": "path", "d": "M18.5 7a7 7 0 010 10"}],
  phone: [{"t": "path", "d": "M6.5 3h3l1.5 4-2 1.5a12 12 0 006.5 6.5l1.5-2 4 1.5v3a2 2 0 01-2.2 2A17 17 0 014.5 5.2 2 2 0 016.5 3z"}],
  phoneoff: [{"t": "path", "d": "M22 2L15 9"}, {"t": "path", "d": "M6.5 3h3l1.5 4-2 1.5a12 12 0 006.5 6.5l1.5-2 4 1.5v3a2 2 0 01-2.2 2A17 17 0 014.5 5.2 2 2 0 016.5 3z"}],
  full: [{"t": "path", "d": "M8 3H5a2 2 0 00-2 2v3"}, {"t": "path", "d": "M16 3h3a2 2 0 012 2v3"}, {"t": "path", "d": "M8 21H5a2 2 0 01-2-2v-3"}, {"t": "path", "d": "M16 21h3a2 2 0 002-2v-3"}],
  grow: [{"t": "path", "d": "M15 3h6v6"}, {"t": "path", "d": "M9 21H3v-6"}, {"t": "path", "d": "M21 3l-7 7"}, {"t": "path", "d": "M3 21l7-7"}],
  shrink: [{"t": "path", "d": "M4 14h6v6"}, {"t": "path", "d": "M20 10h-6V4"}, {"t": "path", "d": "M14 10l7-7"}, {"t": "path", "d": "M3 21l7-7"}],
  pip: [{"t": "rect", "x": "2", "y": "4", "width": "20", "height": "16", "rx": "3"}, {"t": "rect", "x": "12", "y": "12", "width": "8", "height": "6", "rx": "1.5"}],
  voloff: [{"t": "path", "d": "M4 4l16 16"}, {"t": "path", "d": "M11 5L6 9H3v6h3l5 4V5z"}],
  home: [{"t": "path", "d": "M3 10.5L12 3l9 7.5"}, {"t": "path", "d": "M5.5 9.5V20h13V9.5"}],
  search: [{"t": "circle", "cx": "11", "cy": "11", "r": "7"}, {"t": "path", "d": "M20 20l-3.5-3.5"}],
  plus: [{"t": "path", "d": "M12 6v12M6 12h12"}],
  gear: [{"t": "circle", "cx": "12", "cy": "12", "r": "3"}, {"t": "path", "d": "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-4.9 4.9"}],
  mic: [{"t": "path", "d": "M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3z"}, {"t": "path", "d": "M6 11a6 6 0 0012 0"}, {"t": "path", "d": "M12 17v4"}],
  micoff: [{"t": "path", "d": "M4 4l16 16"}, {"t": "path", "d": "M9 5a3 3 0 016 0v5"}, {"t": "path", "d": "M6 11a6 6 0 009 5.2"}, {"t": "path", "d": "M12 19v3"}],
  head: [{"t": "path", "d": "M4 13v-2a8 8 0 0116 0v2"}, {"t": "path", "d": "M4 13h3v6H5a1 1 0 01-1-1z"}, {"t": "path", "d": "M20 13h-3v6h2a1 1 0 001-1z"}],
  headoff: [{"t": "path", "d": "M4 4l16 16"}, {"t": "path", "d": "M4 13v-2a8 8 0 0113-6"}, {"t": "path", "d": "M20 11v2"}, {"t": "path", "d": "M4 13h3v6H5a1 1 0 01-1-1z"}],
  x: [{"t": "path", "d": "M6 6l12 12M18 6L6 18"}],
  /* The window buttons. Drawn in the same 24 box and the same stroke as
     everything else, because they are this app's buttons now rather than
     Windows' - a hairline glyph beside these would read as a foreign part. */
  winmin: [{"t": "path", "d": "M6 12h12"}],
  winmax: [{"t": "rect", "x": "6", "y": "6", "width": "12", "height": "12", "rx": "2.5"}],
  winrestore: [
    {"t": "rect", "x": "5", "y": "9", "width": "10", "height": "10", "rx": "2.5"},
    {"t": "path", "d": "M9 5.5h7.5A2.5 2.5 0 0119 8v7"},
  ],
  pin: [{"t": "path", "d": "M9.5 3h5l-.7 5.2 3.2 3.3H7l3.2-3.3z"}, {"t": "path", "d": "M12 11.5V21"}],
  dl: [{"t": "path", "d": "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],
  up: [{"t": "path", "d": "M12 19V5"}, {"t": "path", "d": "M6 11l6-6 6 6"}],
  send: [{"t": "path", "d": "M5 12h13"}, {"t": "path", "d": "M12 5l7 7-7 7"}],
  dn: [{"t": "path", "d": "M12 5v14"}, {"t": "path", "d": "M6 13l6 6 6-6"}],
  dots: [{"t": "circle", "cx": "5", "cy": "12", "r": "1.4"}, {"t": "circle", "cx": "12", "cy": "12", "r": "1.4"}, {"t": "circle", "cx": "19", "cy": "12", "r": "1.4"}],
  chat: [{"t": "path", "d": "M4 5h16v11H9l-5 4z"}],
  menu: [{"t": "path", "d": "M4 7h16"}, {"t": "path", "d": "M4 12h16"}, {"t": "path", "d": "M4 17h16"}],
  people: [{"t": "circle", "cx": "9", "cy": "8", "r": "3.2"}, {"t": "path", "d": "M3 19a6 6 0 0112 0"}, {"t": "path", "d": "M16 5.6a3 3 0 010 4.8"}, {"t": "path", "d": "M18.5 19a6 6 0 00-2-4.4"}],
  addp: [{"t": "circle", "cx": "9", "cy": "8", "r": "3.2"}, {"t": "path", "d": "M3 19a6 6 0 0112 0"}, {"t": "path", "d": "M18 8v6M15 11h6"}],
  smile: [{"t": "circle", "cx": "12", "cy": "12", "r": "9"}, {"t": "path", "d": "M8.5 14a4.5 4.5 0 007 0"}, {"t": "circle", "cx": "9", "cy": "9.5", "r": "1"}, {"t": "circle", "cx": "15", "cy": "9.5", "r": "1"}],
  crown: [{"t": "path", "d": "M4 18h16M4 18l-1-9 5 3 4-6 4 6 5-3-1 9z"}],
  share: [{"t": "rect", "x": "3", "y": "5", "width": "18", "height": "12", "rx": "2"}, {"t": "path", "d": "M8 21h8"}],
  brush: [{"t": "path", "d": "M4 20c3 1 5-1 5-4 0-2 1-3 3-3l6-6-3-3-6 6c0 2-1 3-3 3-3 0-5 2-4 5z"}],
  shield: [{"t": "path", "d": "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"}],
  user: [{"t": "circle", "cx": "12", "cy": "8", "r": "3.6"}, {"t": "path", "d": "M5 20a7 7 0 0114 0"}],
  info: [{"t": "circle", "cx": "12", "cy": "12", "r": "9"}, {"t": "path", "d": "M12 11v5M12 8h.01"}],
  copy: [{"t": "rect", "x": "9", "y": "9", "width": "11", "height": "11", "rx": "2"}, {"t": "path", "d": "M15 5H6a2 2 0 00-2 2v9"}],
  trash: [{"t": "path", "d": "M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"}],
  check: [{"t": "path", "d": "M5 13l4 4L19 7"}],
  layers: [{"t": "path", "d": "M12 3l9 5-9 5-9-5z"}, {"t": "path", "d": "M3 13l9 5 9-5"}],
  key: [{"t": "circle", "cx": "8", "cy": "14", "r": "4"}, {"t": "path", "d": "M11 11l9-9M17 4l2 2M15 6l2 2"}],
  bell: [{"t": "path", "d": "M6 10a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z"}, {"t": "path", "d": "M10 20a2 2 0 004 0"}],
  out: [{"t": "path", "d": "M15 4h4v16h-4"}, {"t": "path", "d": "M11 8l4 4-4 4"}, {"t": "path", "d": "M15 12H3"}],
  reply: [{"t": "path", "d": "M9 14L4 9l5-5"}, {"t": "path", "d": "M4 9h9a7 7 0 017 7v3"}],
  pencil: [{"t": "path", "d": "M4 20h4L20 8l-4-4L4 16z"}],
  bold: [{"t": "path", "d": "M7 5h6a3.5 3.5 0 010 7H7z"}, {"t": "path", "d": "M7 12h7a3.5 3.5 0 010 7H7z"}],
  italic: [{"t": "path", "d": "M15 5h-5M14 19H9M14 5l-4 14"}],
  eyeoff: [{"t": "path", "d": "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"}, {"t": "path", "d": "M4 4l16 16"}],
  scissors: [{"t": "circle", "cx": "6", "cy": "6", "r": "2.5"}, {"t": "circle", "cx": "6", "cy": "18", "r": "2.5"}, {"t": "path", "d": "M8 8l12 10M20 6L8 16"}],
  paste: [{"t": "rect", "x": "7", "y": "5", "width": "12", "height": "16", "rx": "2"}, {"t": "path", "d": "M9 5V3h6v2"}],
  strike: [{"t": "path", "d": "M4 12h16"}, {"t": "path", "d": "M8 7a4 3 0 016-1M10 17a4 3 0 006-2"}],
  chev: [{"t": "path", "d": "M8 5l7 7-7 7"}],
  poll: [{"t": "path", "d": "M5 20V10M12 20V4M19 20v-7"}],
  cam: [{"t": "rect", "x": "2", "y": "6", "width": "13", "height": "12", "rx": "3"}, {"t": "path", "d": "M15 11l7-4v10l-7-4z"}],
  camoff: [{"t": "path", "d": "M4 4l16 16"}, {"t": "rect", "x": "2", "y": "6", "width": "13", "height": "12", "rx": "3"}, {"t": "path", "d": "M15 11l7-4v10"}],
  expand: [{"t": "path", "d": "M4 9V4h5M20 15v5h-5M4 15v5h5M20 9V4h-5"}],
  /* A clock, for a thing with an end to it. Nothing here was about time -
     belloff is about notifications and micoff is about voice, and a timeout
     is neither. */
  clock: [{"t": "circle", "cx": "12", "cy": "12", "r": "9"}, {"t": "path", "d": "M12 7v5l3.5 2"}],
  game: [{"t": "rect", "x": "2", "y": "7", "width": "20", "height": "11", "rx": "4"}, {"t": "path", "d": "M7 11v3M5.5 12.5h3"}, {"t": "circle", "cx": "16", "cy": "12", "r": "1"}, {"t": "circle", "cx": "18.5", "cy": "14.5", "r": "1"}],
  belloff: [{"t": "path", "d": "M4 4l16 16"}, {"t": "path", "d": "M8 8v2c0 5-2 6-2 6h11"}, {"t": "path", "d": "M10 20a2 2 0 004 0"}],
  img: [{"t": "rect", "x": "3", "y": "5", "width": "18", "height": "14", "rx": "2"}, {"t": "circle", "cx": "9", "cy": "10", "r": "1.6"}, {"t": "path", "d": "M4 17l5-4 4 3 3-2 4 3"}],
  folder: [{"t": "path", "d": "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"}],
  grip: [{"t": "circle", "cx": "9", "cy": "6", "r": "1.3"}, {"t": "circle", "cx": "15", "cy": "6", "r": "1.3"}, {"t": "circle", "cx": "9", "cy": "12", "r": "1.3"}, {"t": "circle", "cx": "15", "cy": "12", "r": "1.3"}, {"t": "circle", "cx": "9", "cy": "18", "r": "1.3"}, {"t": "circle", "cx": "15", "cy": "18", "r": "1.3"}],
  kbd: [{"t": "rect", "x": "2", "y": "6", "width": "20", "height": "12", "rx": "2"}, {"t": "path", "d": "M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"}],
  ban: [{"t": "circle", "cx": "12", "cy": "12", "r": "9"}, {"t": "path", "d": "M5.6 5.6l12.8 12.8"}],
  globe: [{"t": "circle", "cx": "12", "cy": "12", "r": "9"}, {"t": "path", "d": "M3 12h18"}, {"t": "path", "d": "M12 3a15 15 0 010 18a15 15 0 010-18z"}],
  device: [{"t": "rect", "x": "4", "y": "3", "width": "16", "height": "18", "rx": "2"}, {"t": "path", "d": "M10 18h4"}],
  boxes: [{"t": "rect", "x": "3", "y": "3", "width": "8", "height": "8", "rx": "2"}, {"t": "rect", "x": "13", "y": "3", "width": "8", "height": "8", "rx": "2"}, {"t": "rect", "x": "3", "y": "13", "width": "8", "height": "8", "rx": "2"}, {"t": "rect", "x": "13", "y": "13", "width": "8", "height": "8", "rx": "2"}],
} as const satisfies Record<string, readonly Shape[]>

export type IconName = keyof typeof ICONS
