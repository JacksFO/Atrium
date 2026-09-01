import { useCallback, useEffect, useRef, useState } from 'react'
import { notificationFor, shouldNotify, tabTitle } from '../lib/notify'
import { playMention, playPing } from '../lib/sound'
import { badgeIcon, badgeTooltip, shell } from '../lib/shell'
import type { Message, User } from '../lib/wire'
import type { World } from '../lib/world'
import { nameIn, spaceOfChannel } from '../lib/names'

/**
 * The browser half of notifying, which is the half that cannot be tested.
 *
 * Every decision is in notify.ts and asked here — this only reads the window
 * and calls the browser. What is left in it is the sort of thing that can
 * only be got right by knowing the API: permission is asked when somebody
 * turns the setting on rather than on the first message, because a prompt
 * nobody asked for is the thing people refuse on reflex and then cannot
 * easily undo.
 */
/**
 * Whether a message names you.
 *
 * By id first, which is what a mention is written as and what survives a
 * rename, and by handle as well because that is what somebody typing from
 * memory writes. A display name is deliberately not matched: they change, and
 * a common one would have half a server pinging on every message.
 */
function mentionsMe(body: string, me: Pick<User, 'id' | 'username'>): boolean {
  if (body.includes(`<@${me.id}>`)) return true
  return new RegExp(`(^|[\s(])@${me.username}\b`, 'i').test(body)
}

export function useNotify(world: World | null, opts: {
  wanted: boolean
  tabCount: boolean
  openChannel: string | null
  unread: number
}) {
  const [permission, setPermission] = useState<
    'granted' | 'denied' | 'default' | 'unsupported'
  >(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission))

  /* Whether the window is in front of them, watched rather than asked at the
     moment a message arrives — `visibilityState` is right either way, but a
     listener is what makes the count in the tab update when they come back. */
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  )

  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  /** Asked when the setting is turned on, not when a message arrives. */
  const ask = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      setPermission('unsupported')
      return 'unsupported' as const
    }
    if (Notification.permission !== 'default') {
      setPermission(Notification.permission)
      return Notification.permission
    }
    const answer = await Notification.requestPermission()
    setPermission(answer)
    return answer
  }, [])

  /* What has already been said, so a message that arrives twice — an edit, a
     reaction, a reconnect replaying it — is not announced again. */
  const said = useRef(new Set<string>())

  const tell = useCallback((m: Message, who: User | undefined, where: string | null) => {
    if (!world) return
    if (said.current.has(m.id)) return
    const allow = shouldNotify(m, world.me, {
      wanted: opts.wanted,
      permission,
      visible,
      openChannel: opts.openChannel,
      /* What the server remembers about which channels somebody has muted,
         which arrives in the opening frame. */
      muted: world.muted,
      blocked: world.blocked,
    })
    said.current.add(m.id)

    /*
     * The sound, which is not the notification.
     *
     * Heard whether or not a notification is drawn: the browser may have
     * refused permission, the window may be in front of them, the tab count
     * may be all they wanted — and in every one of those cases a message
     * arriving should still make the noise the app has always made for it.
     * The two were one decision, so turning the notification off took the
     * sound with it.
     *
     * Except your own, and except a channel that has been silenced.
     */
    const mine = m.author_id === world.me.id
    const hushed = world.muted.has(m.channel_id)
    /*
     * And silent from somebody who has been blocked.
     *
     * Checked here as well as in shouldNotify because the sound is a
     * separate decision from the notification - deliberately, so that a
     * refused permission does not take the noise with it. That independence
     * is exactly why a single guard would not have covered both.
     */
    const shunned = world.blocked.has(m.author_id)
    if (!mine && !hushed && !shunned) {
      const named = mentionsMe(m.body, world.me)
      if (named) playMention()
      else playPing()
    }

    if (!allow) return

    /* Named the way the app names them, which for a server's channel is
       whatever that server calls them. A notification that says one name and
       the message list another is two people as far as anybody reading it is
       concerned. */
    const { title, body } = notificationFor(
      m,
      who ? nameIn(world, spaceOfChannel(world, m.channel_id), who) : 'Someone',
      where)
    try {
      const n = new Notification(title, { body, tag: m.id, silent: true })
      n.onclick = () => { window.focus(); n.close() }
    } catch {
      /* Refused, or the platform has no room for one. Not worth saying
         anything about: they can see the app. */
    }
  }, [world, opts.wanted, opts.openChannel, permission, visible])

  /* The count in the tab, which is the only notification some people want. */
  useEffect(() => {
    document.title = tabTitle(opts.tabCount ? opts.unread : 0)
  }, [opts.tabCount, opts.unread])

  /*
   * And on the taskbar, where the app has one.
   *
   * The picture is drawn here because the main process has no DOM to draw
   * with — it takes a PNG and checks its shape before believing a word of it.
   * Sent on every change including back to nothing: a badge that is only ever
   * set and never cleared is a number that stays after everything is read.
   */
  useEffect(() => {
    const app = shell()
    if (!app) return
    const n = opts.tabCount ? opts.unread : 0
    app.setBadge(n, badgeIcon(n), badgeTooltip(n))
  }, [opts.tabCount, opts.unread])

  return { permission, ask, tell }
}
