/**
 * What things are called in the app, in one place.
 *
 * Every spec used to hard-code its own selectors. That was survivable while
 * there was one client; it stopped being survivable when the app was rewritten
 * in React and 185 class names changed underneath 64 specs at once. The specs
 * did not fail - they were pointed at the old client for months and passed,
 * in detail, about an app nobody was running.
 *
 * So the names live here. A spec asks for "the rail's home button" and this
 * file knows what that is today. When the markup changes again - and it will -
 * the specs do not need touching, and if something here stops matching, every
 * spec that uses it says so at once instead of quietly testing nothing.
 *
 * These were read off the running app rather than out of the source, because
 * a className written as a ternary is invisible to a grep: a static scan of
 * the React client reported `.msg` as missing from a client that renders it on
 * every single message. test/ui/specs/zz-classes.cjs is what asks the app.
 */

/* ---------------------------------------------------------------- rail -- */

const RAIL = '.pane.rail'
/** Every button in the rail, in order: home, read-all, then the servers. */
const RAIL_BUTTON = '.pane.rail .rl'
/** Home - "Conversations". First in the rail, and titled. */
const RAIL_HOME = '.pane.rail .rl[aria-label="Conversations"]'
/** The unread count on a rail button. */
const RAIL_PIP = '.pane.rail .pip'
/** Make a server. */
const RAIL_NEW = '.pane.rail .rlnew'
/** Mark everything read. */
const RAIL_READ_ALL = '.pane.rail .rlread'
/** The line between home and the servers. */
const RAIL_DIVIDER = '.pane.rail .rdv'

/* ------------------------------------------------------------ channels -- */

const SIDEBAR = '.pane.sidepane'
/** A row in the channel list: a channel in a server, or a conversation. */
const CHANNEL = '.pane.sidepane .chan'
/** The one being read. */
const CHANNEL_ON = '.pane.sidepane .chan.on'
/** A heading above a group of channels. */
const CHANNEL_GROUP = '.pane.sidepane .sect'

/* ----------------------------------------------------------- messages --- */

const CHAT = '.pane.chatpane'
/** The scrolling list of messages. */
const STREAM = '.pane.chatpane .stream'
/** One message. */
const MESSAGE = '.msg'
/** The body of one. */
const MESSAGE_BODY = '.msg .mbody'
/** Who wrote it. */
const MESSAGE_NAME = '.msg .nm'
/** The buttons that appear on hover. */
const MESSAGE_TOOLS = '.msg .tools'
/** The bar across the top of a conversation. */
const CHANNEL_HEAD = '.pane.chatpane .chd'

/* ---------------------------------------------------------- composer --- */

const COMPOSER = '.cmp'
/** The box you type in. Not the first input in the composer - that is the
 *  file picker, and setting its value throws. */
const COMPOSER_BOX = '.cmp textarea'
const COMPOSER_SEND = '.cmp .snd'

/* ----------------------------------------------------------- members --- */

const MEMBERS = '.pane.mempane'
/** One person in the member list. */
const MEMBER = '.pane.mempane .mrow'
/** The button that opens the list when it is a drawer. */
const MEMBERS_TOGGLE = '.memtog'

/* ------------------------------------------------------------- menus --- */

/** A menu opened by a right-click or a dots button. */
const MENU = '.ctx'
/** One thing in it. */
const MENU_ITEM = '.ctx .mitem'
/** The row of quick actions at the top of a message menu. */
const MENU_QUICK = '.ctx .mq'
/** What closes a menu when you click past it. */
const MENU_SCRIM = '.ctxscrim'

/* ---------------------------------------------------------- settings --- */

const SETTINGS = '.settings'
/** The dimmed backdrop it floats on. Pressing it closes the window. */
const SETTINGS_SCRIM = '.setscrim'
/** The list of panes down the side. */
const SETTINGS_NAV = '.settings .snav'
/** One pane in that list. */
const SETTINGS_ITEM = '.settings .snav button'
const SETTINGS_TITLE = '.settings .stitle'
/*
 * Your own settings and a server's are different windows, and only one of
 * them has been rebuilt so far. The close button, the pane that scrolls and
 * the search box are all in new places in the rebuilt one, so each is named
 * twice until the server's window is merged into it.
 */
const SETTINGS_CLOSE = '.setwin .sx'
const SETTINGS_PANE = '.setwin .smain'
/** The search box, now in the bar across the top rather than over the nav. */
const SETTINGS_FIND = '.setwin .sfind input'
/** One thing the search found. */
const SETTINGS_HIT = '.setwin .shit'
/** The third column: what a pane shows rather than says. */
const SETTINGS_ASIDE = '.setwin .saside'
/** The server's own settings, which are still the older window. */
const SERVER_SETTINGS_CLOSE = '.settings .close'
const SERVER_SETTINGS_PANE = '.settings .sbody'

/* ------------------------------------------------------------- other --- */

/** The whole app. */
const APP = '.shell'
/** Your own name and picture, bottom left. */
const ME = '.meid'
/** Somebody's card. */
const PROFILE = '.pcard'
/** The bar across the very top. */
const TOPBAR = '.topbar'
/** A modal. */
const MODAL = '.modal'

module.exports = {
  RAIL, RAIL_BUTTON, RAIL_HOME, RAIL_PIP, RAIL_NEW, RAIL_READ_ALL, RAIL_DIVIDER,
  SIDEBAR, CHANNEL, CHANNEL_ON, CHANNEL_GROUP,
  CHAT, STREAM, MESSAGE, MESSAGE_BODY, MESSAGE_NAME, MESSAGE_TOOLS, CHANNEL_HEAD,
  COMPOSER, COMPOSER_BOX, COMPOSER_SEND,
  MEMBERS, MEMBER, MEMBERS_TOGGLE,
  MENU, MENU_ITEM, MENU_QUICK, MENU_SCRIM,
  SETTINGS, SETTINGS_SCRIM, SETTINGS_NAV, SETTINGS_ITEM, SETTINGS_TITLE,
  SETTINGS_CLOSE, SETTINGS_PANE, SETTINGS_FIND, SETTINGS_HIT, SETTINGS_ASIDE,
  SERVER_SETTINGS_CLOSE, SERVER_SETTINGS_PANE,
  APP, ME, PROFILE, TOPBAR, MODAL,
}
