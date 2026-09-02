import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChannelKind } from '../lib/wire'
import {
  applyFormat, commandInDraft, opensSomething, SLASH, type SlashCommand,
} from '../lib/composer'
import { searchEmoji } from '../lib/emoji'
import { anchorOf, type Anchor } from './useAnchored'
import { EmojiPicker } from './EmojiPicker'
import { GifPicker } from './GifPicker'
import type { Gif } from '../lib/gifs'
import type { Api } from '../lib/api'
import { Icon } from './Icon'
import { Menu, type MenuItem } from './Menu'
import type { IconName } from './icons'
import type { Pending } from './useUpload'

/**
 * The message box.
 *
 * Enter sends and Shift+Enter makes a new line, which is what everybody
 * expects and what nobody says out loud. The draft is state, so a re-render
 * cannot lose it — in the old client the box was rebuilt on every render and
 * being thrown out of it mid-sentence was a real complaint.
 */
/** Somebody, or some role, that can be named in a message. */
export type Mention = {
  id: string
  name: string
  handle: string
  /** A role is named as a whole and is written differently on the wire. */
  kind?: 'person' | 'role'
}

/** What a mention looks like in a message, as opposed to in the box. */
export const wireFor = (m: Mention): string =>
  m.kind === 'role' ? `<@&${m.id}>` : `<@${m.id}>`

/**
 * The @ being typed, if one is.
 *
 * Read back from the caret rather than matched over the whole draft: a
 * message can mention four people and only the one being typed should be
 * offering anybody. A space ends it, because a name with a space in it cannot
 * be told from the sentence that follows.
 */
export function mentionAt(text: string, caret: number): { from: number; query: string } | null {
  let i = caret - 1
  while (i >= 0) {
    const ch = text[i] ?? ''
    if (ch === '@') {
      const before = i > 0 ? text[i - 1] ?? '' : ' '
      /* Only where a word can start, or every email address opens a menu. */
      if (!/[\s(]/.test(before) && i > 0) return null
      return { from: i, query: text.slice(i + 1, caret) }
    }
    if (/[\s@]/.test(ch)) return null
    i--
  }
  return null
}

/** Who the typed letters are looking for, best first. */
export function mentionMatches(people: Mention[], query: string, max = 8): Mention[] {
  const q = query.toLowerCase()
  const starts: Mention[] = []
  const inside: Mention[] = []
  for (const m of people) {
    const n = m.name.toLowerCase()
    const h = m.handle.toLowerCase()
    if (!q) { starts.push(m); continue }
    if (n.startsWith(q) || h.startsWith(q)) starts.push(m)
    else if (n.includes(q) || h.includes(q)) inside.push(m)
  }
  return [...starts, ...inside].slice(0, max)
}

/**
 * Names, turned into who they name, on the way out.
 *
 * Two sources, and both are needed. What was chosen from the menu is known
 * exactly, which settles two people sharing a display name and roles whose
 * names have spaces in them. Anything else typed by hand is matched against
 * handles, which cannot collide and do not change — so `@jack` written from
 * memory still becomes a mention that follows him through a rename.
 *
 * Longest first, or `@jack` would be substituted inside `@jackson`.
 */
export function asWire(
  text: string,
  picked: ReadonlyMap<string, string>,
  people: readonly Mention[] = [],
): string {
  const swaps = new Map(picked)
  for (const m of people) {
    if (m.kind === 'role') continue
    const shown = `@${m.handle}`
    if (!swaps.has(shown)) swaps.set(shown, wireFor(m))
  }
  let out = text
  for (const shown of [...swaps.keys()].sort((a, b) => b.length - a.length)) {
    const wire = swaps.get(shown)
    if (!wire) continue
    /* Only where the name stands on its own — inside a word it is part of
       the word, and inside an address it is an address. */
    out = out.split(shown).join(wire)
  }
  return out
}

/*
 * What each of them puts round the words, in the app's own markup, and the
 * keys that do the same thing.
 *
 * The key is shown beside the item: a menu is where somebody finds out that
 * there is a shortcut at all, and one that keeps the secret is a menu they
 * go on using for ever.
 */
const MARKS: ReadonlyArray<readonly [string, string, string, string?]> = [
  ['Bold', 'bold', '**', 'Ctrl+B'],
  ['Italic', 'italic', '*', 'Ctrl+I'],
  ['Underline', 'kbd', '__', 'Ctrl+U'],
  ['Strikethrough', 'strike', '~~', 'Ctrl+Shift+X'],
  ['Spoiler', 'eyeoff', '||', 'Ctrl+Shift+S'],
  ['Code', 'kbd', '`'],
]

/*
 * And the two that take whole lines rather than a few words.
 *
 * A quote and a code block are line things - the mark goes at the start of
 * the line and the rest of it comes along - so wrapping the selection the
 * way the others do would put a fence in the middle of a sentence.
 */
const LINE_MARKS: ReadonlyArray<readonly [string, string, string]> = [
  ['Quote', 'reply', '> '],
  ['Code block', 'kbd', '```'],
]

/** And the keys, which are the same everywhere and worth honouring. */
const SHORTCUTS: Record<string, string> = { b: '**', i: '*', u: '__' }

/*
 * The ones that want shift as well, because the plain letter is taken.
 *
 * Ctrl+S is save in every browser and Ctrl+X is cut; the marks that would
 * have wanted them take shift instead, which is where every other app puts
 * them too.
 */
const SHIFT_SHORTCUTS: Record<string, string> = { s: '||', x: '~~' }

export function Composer({
  name, kind, onSend, onTyping, pending, onPick, onDrop, uploadError, disabled,
  server, onGif, mentionable, onEditLast, permissions, onPoll, where,
  replying, onCancelReply, focusAt,
}: {
  /** What is open, for the placeholder. Null when nothing is. */
  name: string | null
  kind: ChannelKind | null
  /* True when it went. A message that did not go leaves the words in the
     box, because clearing it is how they get lost. */
  onSend: (body: string) => boolean | void
  /** Said as they type, and throttled by whoever handles it — one notice per
   *  couple of seconds rather than one per key. */
  onTyping?: () => void
  /** Pictures already uploaded and waiting to go with the next message. */
  pending?: Pending[]
  onPick?: (file: File) => void
  onDrop?: (url: string) => void
  uploadError?: string
  disabled?: boolean
  /** For the GIF panel, which searches through this server. */
  server?: Api
  onGif?: (g: Gif) => void
  /**
   * Everybody who can be named here.
   *
   * Only the people in this conversation — the whole address book would offer
   * strangers from other servers, which is the independence rule broken in a
   * dropdown.
   */
  mentionable?: Mention[]
  /**
   * What may be done in this channel, as the server answered for it.
   *
   * The box was drawn for everybody, so somebody who cannot write here could
   * type a message, press send and be told no by the server — which is the
   * one thing the app is supposed to spare them. Undefined means nobody has
   * asked, which is a conversation rather than a channel and where everything
   * is allowed.
   */
  permissions?: readonly string[]
  /** Asking a question, which opens its own box. Absent without the
   *  permission, so /poll is not a command that ends in a refusal. */
  onPoll?: () => void
  /**
   * Up, on an empty box: take back the last thing you said.
   *
   * The fastest way to fix a typo, and the one everybody reaches for without
   * being told. Only from an empty box, so it can never eat a draft — and
   * only when nothing is already being edited.
   */
  onEditLast?: () => void
  /** Whether a reply is being written, which is what Escape cancels. */
  replying?: boolean
  onCancelReply?: () => void
  /**
   * Put the cursor in the box.
   *
   * A number rather than a function, because the thing asking is an event
   * that has already happened - choosing Reply - and what it wants is "focus
   * now", again, even if it was already focused. A changing value says that;
   * a boolean cannot say it twice.
   */
  focusAt?: number
  /**
   * Which conversation is being written in.
   *
   * A half-written sentence belongs to the conversation it was meant for.
   * The box kept one string for everywhere, so glancing at another channel
   * carried what you were saying into it - and coming back found it gone,
   * or worse, found it in the wrong place and sent it there.
   */
  where?: string | null
}) {
  const [draft, setDraft] = useState('')
  /* Said out loud when a message did not go, because the only other sign is
     the box still being full - which reads as a key that did not register. */
  const [sendFailed, setSendFailed] = useState(false)

  /*
   * What is half-written in each of the others.
   *
   * Kept for the session rather than saved: it is a sentence in progress,
   * not a preference, and a draft surviving a restart is a surprise nobody
   * asked for. Empty ones are dropped so the map does not grow a key for
   * every channel ever opened.
   */
  const drafts = useRef(new Map<string, string>())
  const wasIn = useRef<string | null | undefined>(where)
  if (wasIn.current !== where) {
    const leaving = wasIn.current
    if (leaving) {
      if (draft) drafts.current.set(leaving, draft)
      else drafts.current.delete(leaving)
    }
    wasIn.current = where
    /* Written during the render that changes conversation, so the box never
       shows the last one's words for a frame. */
    setDraft(where ? drafts.current.get(where) ?? '' : '')
  }
  /* The @ being typed: where it starts, and what has been typed after it. */
  const [at, setAt] = useState<{ from: number; query: string } | null>(null)
  /* The command being typed, or null. Only ever the whole draft: once there
     is an argument the command has been chosen and the menu is in the way. */
  const [slash, setSlash] = useState<string | null>(null)
  /* What was chosen from the menu, and what it stands for. */
  const picked = useRef(new Map<string, string>())
  /* What the menu was last showing, so moving through it does not count as
     the search having changed. */
  const showing = useRef('')
  /* The shortcode being typed, without its colons. */
  const [code, setCode] = useState<{ from: number; query: string } | null>(null)
  /* The right-click menu on the box itself, where it was asked for. */
  const [menu, setMenu] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null)
  const [sel, setSel] = useState(0)
  const box = useRef<HTMLTextAreaElement>(null)

  /*
   * The box grows with what is in it.
   *
   * A textarea is one row tall and stays that way: type a paragraph and you
   * get a single line with a scrollbar inside it, and no way to see what you
   * have written without scrolling a box the height of one line. The client
   * this replaced grew, and nothing here did - which nobody noticed, because
   * the spec that covers it was being run against that other client.
   *
   * Height is cleared before it is measured, or scrollHeight only ever
   * reports the height it was already given and the box can grow but never
   * shrink again. The ceiling is the stylesheet's max-height; past that it
   * scrolls, which is right - a message box should not become the window.
   */
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])
  const picker = useRef<HTMLInputElement>(null)
  /* Where the picker was opened from, or null when it is shut. */
  const [picking, setPicking] = useState<Anchor | null>(null)
  /* Where the GIF button is, so the panel opens beside it. */
  const [gifs, setGifs] = useState<Anchor | null>(null)


  const people = at && mentionable?.length
    ? mentionMatches(mentionable, at.query)
    : []

  const commands = slash === null
    ? []
    : SLASH.filter((c) => c.name.startsWith(slash))

  const codes = code ? searchEmoji(code.query).slice(0, 8) : []

  /*
   * One list, whichever it is showing.
   *
   * The two cannot both be open — a mention needs an @ before the caret and
   * a command needs a / at the very start — so they share a list, a selected
   * row and the keys that move it.
   */
  const rows: Array<{ key: string; pick: () => void; body: React.ReactNode }> =
    codes.length
      ? codes.map((e) => ({
        key: e.name,
        pick: () => putCode(e),
        body: <><b className="big">{e.glyph}</b><span className="args">:{e.name}:</span></>,
      }))
      : people.length
      ? people.map((m) => ({
        key: m.id,
        pick: () => pick(m),
        body: <><b>{m.name}</b><span className="args">@{m.handle}</span></>,
      }))
      : commands.map((c) => ({
        key: c.name,
        pick: () => complete(c),
        body: (
          <>
            <b>/{c.name}</b>
            {c.args && <span className="args">{c.args}</span>}
            <span className="hint">{c.hint}</span>
          </>
        ),
      }))

  /**
   * Putting somebody into the draft.
   *
   * Written as `<@id>`, not as their name. A name is what they were called
   * when it was typed, so every mention went stale the moment anybody renamed
   * themselves; an id is who they are, and the message shows whatever they
   * are called at the time it is read.
   */
  function pick(m: Mention) {
    const el = box.current
    if (!at || !el) return
    const caret = el.selectionStart ?? draft.length
    /*
     * The name goes in the box; the id goes on the wire.
     *
     * Writing `<@0f3c…>` straight into the box put a uuid in the middle of
     * the sentence somebody was writing — the message they were composing
     * became unreadable to the person composing it. What is stored still has
     * to be the id, so that a mention survives a rename, so the swap happens
     * when it is sent instead. Remembered rather than worked out again: two
     * people can share a display name, and the one that was picked is known.
     */
    const shown = m.kind === 'role' ? `@${m.name}` : `@${m.handle}`
    picked.current.set(shown, wireFor(m))
    const next = `${draft.slice(0, at.from)}${shown} ${draft.slice(caret)}`
    const to = at.from + shown.length + 1
    setDraft(next)
    setAt(null)
    setSel(0)
    /* After React has written the value, or the caret is put into the old
       one and lands wherever the browser felt like. */
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(to, to)
    })
  }

  /**
   * Finishing a command's name.
   *
   * The name and a space, not the whole thing run — every one of these takes
   * something after it, and running it the moment it is named would send an
   * empty /me the instant somebody typed the word.
   */
  function complete(c: SlashCommand) {
    const el = box.current
    setDraft(`/${c.name} `)
    setSlash(null)
    setSel(0)
    requestAnimationFrame(() => {
      el?.focus()
      const to = c.name.length + 2
      el?.setSelectionRange(to, to)
    })
  }

  /**
   * Putting the character in, rather than the name of it.
   *
   * `:fire:` in a sent message is already drawn as the character, so writing
   * the glyph straight into the box means what is on screen while writing and
   * what is on screen after sending are the same thing.
   */
  function putCode(e: { name: string; glyph: string }) {
    const el = box.current
    if (!code || !el) return
    const caret = el.selectionStart ?? draft.length
    const next = `${draft.slice(0, code.from)}${e.glyph} ${draft.slice(caret)}`
    const to = code.from + e.glyph.length + 1
    setDraft(next)
    setCode(null)
    setSel(0)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(to, to)
    })
  }

  /**
   * Putting marks around what is selected.
   *
   * Around the selection where there is one, and around the caret where there
   * is not — typing between the marks then does what somebody pressing Bold
   * on an empty box meant by it. Pressing it again on text already wrapped
   * takes the marks off, because the alternative is `****bold****`.
   */
  /*
   * A mark at the start of every line it covers, rather than round the words.
   *
   * A quote and a code block are about lines: `> ` goes at the front of each
   * one, and a fence goes on its own line either side. Wrapping a selection
   * the way bold does would put the fence in the middle of a sentence.
   */
  function lineWrap(mark: string) {
    const el = box.current
    if (!el) return
    /*
     * Out to the ends of the lines it touches.
     *
     * A quote marks a line, not a phrase - selecting one word in the middle
     * of a sentence and asking for a quote should quote the sentence, not
     * put a > in the middle of it. The same for a fence: half a line inside
     * one is not a code block.
     */
    const at = el.selectionStart ?? 0
    const until = el.selectionEnd ?? at
    const lineFrom = draft.lastIndexOf('\n', at - 1) + 1
    const nextBreak = draft.indexOf('\n', until)
    const lineTo = nextBreak === -1 ? draft.length : nextBreak
    const from = lineFrom
    const to = lineTo
    const chosen = draft.slice(from, to)
    const before = draft.slice(0, from)
    const after = draft.slice(to)

    const fence = '```'
    const body = mark === fence
      ? fence + '\n' + chosen + '\n' + fence
      : chosen.split('\n').map((l) => mark + l).join('\n')
    const next = before + body + after
    setDraft(next)
    queueMicrotask(() => {
      el.focus()
      const end = from + body.length
      el.setSelectionRange(end, end)
    })
  }

  /*
   * Wrapping, and unwrapping when it is already wrapped in this.
   *
   * The rule this turns on is that italic is one star and bold is two, so
   * bolding something and then italicising it finds a star either side,
   * decides it is already italic, and takes one off each end - which turns
   * bold into italic. Getting that right means knowing which marker owns a
   * run of markers, which means knowing all of them.
   *
   * That was written twice. There was a copy here that approximated the rule
   * by looking at one character, and applyFormat in lib/composer, which knows
   * the whole table and has the tests - including that exact case. The tested
   * one was the one nothing called. This now calls it, so the logic that runs
   * is the logic that is checked, and there is one of it.
   */
  function wrap(mark: string) {
    const el = box.current
    if (!el) return
    const from = el.selectionStart ?? 0
    const to = el.selectionEnd ?? from
    const next = applyFormat(draft, from, to, mark)

    setDraft(next.text)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(next.start, next.end)
    })
  }

  /**
   * The menu on the box.
   *
   * A browser draws its own for a text box; Electron draws none at all, so in
   * the desktop app right-clicking what you had just selected offered nothing
   * whatever — no copy, no paste, nothing. This is drawn by the app, so both
   * get the same one, and it can carry the formatting as well.
   */
  function boxMenu(e: React.MouseEvent<HTMLTextAreaElement>) {
    /*
     * Not on a phone, where the long press belongs to the phone.
     *
     * Holding a finger on a text box brings up the selection bubble -
     * Paste, Select All, Look Up - and drawing our own menu instead takes
     * all of that away and gives back a worse version of it. This menu was
     * asked for on a desktop, where a right-click otherwise offered nothing
     * at all, and the event is left alone here.
     */
    if (window.matchMedia('(max-width: 820px)').matches) return

    const el = e.currentTarget
    const from = el.selectionStart ?? 0
    const to = el.selectionEnd ?? from
    const chosen = draft.slice(from, to)
    e.preventDefault()

    const items: MenuItem[] = []
    if (chosen) {
      for (const [label, icon, mark, key] of MARKS) {
        items.push({
          kind: 'item', label, icon: icon as IconName,
          ...(key ? { hint: key } : {}),
          onPick: () => wrap(mark),
        })
      }
      for (const [label, icon, mark] of LINE_MARKS) {
        items.push({
          kind: 'item', label, icon: icon as IconName,
          onPick: () => lineWrap(mark),
        })
      }
      items.push({ kind: 'rule' })
    }
    /*
     * There and grey with nothing selected, rather than absent.
     *
     * Cut and Copy are what somebody opens this menu for, and a menu that
     * has neither in it reads as a menu that cannot do them. Grey says the
     * truth instead: they are here, and there is nothing to cut yet.
     */
    items.push({
      kind: 'item', label: 'Copy', icon: 'copy', hint: 'Ctrl+C',
      disabled: !chosen,
      onPick: () => { if (chosen) void navigator.clipboard?.writeText(chosen) },
    })
    items.push({
      kind: 'item', label: 'Cut', icon: 'copy', hint: 'Ctrl+X',
      disabled: !chosen,
      onPick: () => {
        if (!chosen) return
        void navigator.clipboard?.writeText(chosen)
        setDraft(draft.slice(0, from) + draft.slice(to))
      },
    })
    items.push({
      kind: 'item', label: 'Paste', icon: 'paste', hint: 'Ctrl+V',
      onPick: () => {
        void navigator.clipboard?.readText().then((t) => {
          if (!t) return
          setDraft(draft.slice(0, from) + t + draft.slice(to))
          requestAnimationFrame(() => {
            el.focus()
            const at = from + t.length
            el.setSelectionRange(at, at)
          })
        }).catch(() => { /* the browser would not allow it */ })
      },
    })
    if (draft) {
      items.push({
        kind: 'item', label: 'Select all', icon: 'check', hint: 'Ctrl+A',
        onPick: () => { el.focus(); el.setSelectionRange(0, draft.length) },
      })
    }
    setMenu({ items, x: e.clientX, y: e.clientY })
  }

  /** Whatever the caret is sitting in now. */
  function look(el: HTMLTextAreaElement) {
    const v = el.value
    const caret = el.selectionStart ?? v.length
    const who = mentionable?.length ? mentionAt(v, caret) : null
    setAt(who)
    /* A command, while its name is all there is. Editing an old message is
       not the place for one: the text is already a message. */
    const typing = /^\/([a-z]*)$/i.exec(v)
    const cmd = typing ? (typing[1] ?? '').toLowerCase() : null
    setSlash(cmd)
    /* `:` and at least two letters, so an ordinary colon in a sentence — and
       the one in a smiley — is left alone. */
    const short = /(?:^|\s)(:([a-z0-9_+-]{2,}))$/i.exec(v.slice(0, caret))
    const shortcode = short
      ? { from: caret - (short[1] ?? '').length, query: (short[2] ?? '').toLowerCase() }
      : null
    setCode(shortcode)

    /*
     * Back to the first row only when the search itself changed.
     *
     * This ran on every key up, arrow keys included — so pressing Down moved
     * the highlight and then this put it straight back on the first row, and
     * the menu could not be moved through at all. The caret moving is not the
     * search changing.
     */
    /* Built from what was just worked out, not from the state — the state
       still holds the previous render's answer at this point. */
    const now = `${who ? `@${who.query}` : ''}|${cmd ?? ''}|${shortcode?.query ?? ''}`
    if (now !== showing.current) {
      showing.current = now
      setSel(0)
    }
  }

  function send() {
    const text = draft.trim()
    /* A picture on its own is a message. Requiring words as well is how
       somebody attaches one, presses Enter, and nothing happens. */
    if (!name) return
    /* An edit cleared to nothing is a deletion being asked about, and whoever
       is listening decides that — so it still goes. */
    if (!text && !pending?.length) return

    /*
     * A command that opens something is not a message.
     *
     * It has nothing to turn into text, so sending it put its own name in the
     * channel — "/gif" arriving as the word. Handled here rather than by
     * naming each one at the keyboard, so a command added later cannot be
     * forgotten: /poll did exactly this, because only /gif had been thought
     * of when the special case was written.
     */
    const opens = opensSomething(text)
    if (opens) {
      setDraft('')
      /*
       * And the list of commands goes with it.
       *
       * That list is drawn from `slash`, which is maintained by the change
       * handler - and setting the draft from code never fires one. So the
       * draft emptied, the picker opened, and the "/poll" menu stayed behind
       * it until somebody pressed Escape or clicked away. Reported exactly
       * that way.
       */
      setSlash(null)
      if (opens.name === 'gif') setGifs(anchorOf(box.current ?? document.body))
      if (opens.name === 'poll') onPoll?.()
      return
    }

    /* The text commands become their text and go as an ordinary message. */
    const cmd = commandInDraft(text)
    const written = cmd?.cmd.run ? cmd.cmd.run(cmd.rest) : text
    /* And every name in it becomes whoever it names. */
    const body = asWire(written, picked.current, mentionable)
    if (!body) return

    /*
     * Cleared only if it went.
     *
     * Messages go over the gateway socket, and a socket that is not open
     * drops what it is handed. The box used to empty either way, so a wifi
     * blip or a restart of the server mid-sentence took the words with it and
     * said nothing - which for a chat app is the worst thing that can happen
     * quietly. Now the words stay where they are, and can be sent again when
     * the line comes back.
     *
     * `false` and nothing else counts as a failure: the older callers of this
     * return nothing at all, and treating that as a drop would leave the box
     * full after every message.
     */
    if (onSend(body) === false) {
      setSendFailed(true)
      return
    }
    setSendFailed(false)
    picked.current.clear()
    setDraft('')
    /* Kept, because sending is not a reason to stop typing. */
    box.current?.focus()
  }

  /*
   * Asked to take the cursor.
   *
   * Choosing Reply from a message's menu put a banner above the box and left
   * the cursor wherever it was, so the next thing anybody did was click into
   * the box to start typing - a step the app had already decided to take for
   * them and then did not.
   *
   * Skipped on the first render: `focusAt` starts at a number like any other
   * and this must not steal the cursor from somebody who has just opened the
   * app, or on every channel change.
   */
  const focusedAt = useRef(focusAt)
  useEffect(() => {
    if (focusAt === focusedAt.current) return
    focusedAt.current = focusAt
    box.current?.focus()
  }, [focusAt])


  const maySend = !permissions || permissions.includes('send_messages')

  /**
   * Start typing and it goes in the box.
   *
   * Coming back to the window and typing put the letters nowhere: the box has
   * to be clicked first, and the first word of what somebody meant to say is
   * gone by the time they notice. Every app people compare this one to picks
   * the box up for them.
   *
   * Focused during keydown rather than on the character arriving, which is
   * what makes the keystroke land: the browser finishes the event by putting
   * the character into whatever holds focus at the end of it, so moving focus
   * here means nothing is dropped and nothing has to be replayed by hand.
   *
   * Deliberately narrow, because this hijacks the keyboard for the whole
   * window. One printable character with no modifier, and nothing already
   * taking typing - anything else is a shortcut, a menu, or somebody writing
   * in a box that is not this one.
   */
  useEffect(() => {
    if (!maySend) return
    const start = (e: KeyboardEvent) => {
      /* Somebody else has already acted on it. */
      if (e.defaultPrevented) return
      /* A shortcut, not a letter. Shift is allowed: it is how capitals and
         most punctuation are typed. */
      if (e.ctrlKey || e.metaKey || e.altKey) return
      /* One character. Enter, Escape, Tab, the arrows and the F-keys all
         report a name here rather than a character, and every one of them
         means something to somewhere else on screen. */
      if (e.key.length !== 1) return

      const el = box.current
      if (!el || el === document.activeElement) return

      /*
       * Nothing else is taking typing.
       *
       * The search box, the name of a channel being renamed, a message being
       * edited, the box in a dialog - all of them are somewhere somebody is
       * deliberately writing, and stealing a letter out of one is worse than
       * never having done this at all.
       */
      const on = document.activeElement as HTMLElement | null
      if (on && (on.tagName === 'INPUT' || on.tagName === 'TEXTAREA'
        || on.tagName === 'SELECT' || on.isContentEditable)) return

      /*
       * And the box is actually the thing at its own position.
       *
       * Something open over the conversation - settings, a dialog, a menu,
       * a picture - owns the keyboard while it is up, and the box behind it
       * is not what anybody is using. The first version of this listed those
       * by class, which is a list that goes stale the day somebody adds an
       * overlay and forgets: the composer is mounted the whole time settings
       * is open, so typing in there put characters into a box nobody could
       * see.
       *
       * Asked geometrically instead. If the topmost thing where the box is
       * drawn is not the box, something is over it, whatever that something
       * happens to be called. It also covers the box being scrolled away or
       * collapsed to nothing, which a class list never would.
       *
       * Only reached when focus is on something that does not take typing,
       * which is not the common case - typing into the box itself returns
       * three lines above this.
       */
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (hit !== el && !el.contains(hit)) return

      el.focus()
    }
    window.addEventListener('keydown', start)
    return () => window.removeEventListener('keydown', start)
  }, [maySend])
  const mayAttach = !permissions || permissions.includes('attach_files')

  /*
   * Nothing to write with, and a sentence saying why.
   *
   * Not a disabled box: a box somebody can put a cursor in and not type into
   * reads as broken. A line where the box was reads as a rule.
   */
  if (!maySend) {
    return (
      <div className="cmp">
        <p className="cantsend">
          You can read this channel but not write in it.
        </p>
      </div>
    )
  }

  return (
    <div className="cmp">
      {/*
        * Who is being named, above the box.
        *
        * Not through a portal: it belongs to the composer, moves with it, and
        * the stylesheet already places it against `.cmp`. Pressed rather than
        * clicked — mousedown, because a click lands after the box has lost
        * focus and the list has already been told to close.
        */}
      {rows.length > 0 && (
        <div className="picker" role="listbox"
          aria-label={codes.length ? 'Emoji' : people.length ? 'People' : 'Commands'}>
          <p className="ph">
            {codes.length ? 'Emoji' : people.length ? 'People' : 'Commands'}
          </p>
          {rows.map((r, i) => (
            <button
              key={r.key}
              type="button"
              role="option"
              aria-selected={i === sel}
              /*
               * Scrolled to when the keyboard picks it.
               *
               * The list is taller than the box it is in, so arrowing past
               * the fourth name moved a selection nobody could see - and
               * pressing Enter then chose somebody off screen. `nearest`
               * rather than `center`, so using the mouse does not shunt the
               * list about under the pointer.
               */
              ref={(el) => {
                if (el && i === sel) el.scrollIntoView({ block: 'nearest' })
              }}
              className={i === sel ? 'pitem on' : 'pitem'}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => { e.preventDefault(); r.pick() }}
            >
              {r.body}
            </button>
          ))}
        </div>
      )}

      {uploadError && <div className="err" style={{ margin: '0 0 6px' }}>{uploadError}</div>}

      {sendFailed && (
        <div className="sayfail" role="status">
          That did not send — the app is not connected. Your message is still here.
        </div>
      )}
      {!!pending?.length && (
        <div className="pend">
          {pending.map((p) => (
            <span key={p.url} className="pendone">
              <img src={p.preview} alt={p.filename} />
              <button className="icb" aria-label={`Take ${p.filename} off`}
                onClick={() => onDrop?.(p.url)}>
                <Icon name="x" size={14} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="cin">
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onPick?.(f)
            /* Cleared, or choosing the same file twice in a row does nothing
               the second time — the input's value has not changed. */
            e.target.value = ''
          }}
        />
        {/* Absent rather than refused: a channel that does not take files
            should not offer a button that opens a file picker and then a
            refusal from the server. */}
        {mayAttach && (
          <button className="ic" aria-label="Attach a picture" disabled={disabled}
            onClick={() => picker.current?.click()}>
            <Icon name="plus" size={18} />
          </button>
        )}
        <textarea
          ref={box}
          rows={1}
          value={draft}
          disabled={disabled || !name}
          placeholder={name
            ? `Message ${kind === 'text' ? '#' : kind === 'dm' ? '@' : ''}${name}`
            : 'Pick a conversation'}
          onChange={(e) => {
            setDraft(e.target.value)
            look(e.target)
            if (e.target.value) onTyping?.()
          }}
          /* The caret can move without the text changing — an arrow key out
             of a half-typed name should shut the list, not leave it offering
             matches for something nobody is typing any more. */
          onKeyUp={(e) => look(e.currentTarget)}
          onClick={(e) => look(e.currentTarget)}
          onContextMenu={boxMenu}
          onPaste={(e) => {
            /* A screenshot in the clipboard is the commonest way anybody
               attaches one, and asking them to save it to a file first is a
               step nobody should have to take. */
            const img = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))
            const file = img?.getAsFile()
            if (file) { e.preventDefault(); onPick?.(file) }
          }}
          onKeyDown={(e) => {
            /* While the list is up it owns the keys that move and choose.
               Enter here means "that one", not "send" — sending a message
               that ends in a half-typed name is the mistake this prevents. */
            if (rows.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const by = e.key === 'ArrowDown' ? 1 : -1
                setSel((i) => (i + by + rows.length) % rows.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                const one = rows[sel]
                /*
                 * Enter completes what is half typed, and sends what is not.
                 *
                 * A name typed out in full has nothing left to complete, so
                 * Enter there means what it has always meant — otherwise
                 * `/shrug` and Enter, which used to send a shrug, would put a
                 * space after the word and wait. Tab always completes: it has
                 * no other meaning here.
                 */
                const exact = slash !== null && slash === one?.key
                if (one && !(exact && e.key === 'Enter')) {
                  e.preventDefault()
                  one.pick()
                  return
                }
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setAt(null)
                setSlash(null)
                setCode(null)
                return
              }
            }
            /* Nothing offering itself, and a reply being written: Escape puts
               it down. It was the one way out of replying that was not built,
               so the only way to stop was to find the small button. */
            if (e.key === 'Escape' && replying && onCancelReply) {
              e.preventDefault()
              onCancelReply()
              return
            }
            /* The shortcuts everybody already has in their fingers. Listed
               in the keyboard pane since before this build and bound to
               nothing, so pressing Ctrl+B did whatever the browser felt. */
            if (e.ctrlKey || e.metaKey) {
              const table = e.shiftKey ? SHIFT_SHORTCUTS : SHORTCUTS
              const mark = table[e.key.toLowerCase()]
              if (mark) { e.preventDefault(); wrap(mark); return }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
            /* Nothing typed, nothing being edited: up means the last one.
               With anything in the box it is a caret key and stays one. */
            if (e.key === 'ArrowUp' && !draft && onEditLast) {
              e.preventDefault()
              onEditLast()
            }
          }}
        />
        {mayAttach && server && onGif && (
          <button className="ic" aria-label="GIF" disabled={disabled}
            onClick={(e) => setGifs(anchorOf(e.currentTarget))}>
            <Icon name="img" size={18} />
          </button>
        )}
        <button
          className="ic"
          aria-label="Emoji"
          disabled={disabled}
          onClick={(e) => setPicking(anchorOf(e.currentTarget))}
        >
          <Icon name="smile" size={18} />
        </button>
        <button className="snd" aria-label="Send" onClick={send}
          disabled={disabled || (!draft.trim() && !pending?.length)}>
          <Icon name="up" size={15} />
        </button>
      </div>

      {menu && (
        <Menu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}

      {gifs && server && onGif && (
        <GifPicker
          server={server}
          anchor={gifs}
          onPick={(g) => { onGif(g); setGifs(null); box.current?.focus() }}
          onClose={() => setGifs(null)}
        />
      )}

      {picking && (
        <EmojiPicker
          anchor={picking}
          onPick={(glyph) => {
            /* Into the box rather than sent: an emoji is usually part of a
               sentence, and a picker that sends is one that cannot be used to
               write one. */
            setDraft((d) => d + glyph)
            setPicking(null)
            box.current?.focus()
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
