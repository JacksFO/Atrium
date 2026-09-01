/**
 * What the message box is doing while somebody types.
 *
 * All of it decided from the draft and where the caret is, and nothing else —
 * no element, no event, no selection object. That is what makes it testable,
 * and it is also what went wrong in the old client: the caret was read off
 * the box at the moment of drawing, so a render in between moved it, and
 * picking a mention with Enter left the caret four characters inside the name
 * it had just inserted.
 */

export type SlashKind = 'action' | 'text'

export type SlashCommand = {
  name: string
  args: string
  hint: string
  kind: SlashKind
  /** What it turns the rest of the line into. Absent for the ones that open
   *  something instead of writing something. */
  run?: (rest: string) => string
}

export const SLASH: readonly SlashCommand[] = [
  { name: 'gif', args: '[search]', hint: 'Open the GIF picker', kind: 'action' },
  /* There are polls now: tables, two routes, and the counts riding on the
     message the way a reaction does. */
  { name: 'poll', args: '', hint: 'Ask a question', kind: 'action' },
  { name: 'me', args: '<message>', hint: 'Say something in the third person', kind: 'text', run: (r) => `*${r}*` },
  { name: 'shrug', args: '', hint: 'Append ¯\\_(ツ)_/¯', kind: 'text', run: (r) => (r ? `${r} ` : '') + '¯\\_(ツ)_/¯' },
  { name: 'spoiler', args: '<message>', hint: 'Hide the whole message', kind: 'text', run: (r) => `||${r}||` },
  { name: 'tableflip', args: '', hint: 'Append (╯°□°）╯︵ ┻━┻', kind: 'text', run: (r) => (r ? `${r} ` : '') + '(╯°□°）╯︵ ┻━┻' },
  { name: 'unflip', args: '', hint: 'Append ┬─┬ ノ( ゜-゜ノ)', kind: 'text', run: (r) => (r ? `${r} ` : '') + '┬─┬ ノ( ゜-゜ノ)' },
]

/*
 * There were four more here: activeCommand, activeMention, activeEmoji and
 * insertAt. The message box has never called any of them - it finds the @
 * being typed with its own mentionAt, the slash with commandInDraft below,
 * and the shortcode with searchEmoji - so they were a second implementation
 * of things the app already does, kept alive by their own tests.
 *
 * The one thing those tests knew that the box's did not was where the caret
 * ends up after a name is chosen, which is a real bug somebody hit. That
 * moved to Mentions.test.tsx, where it is asked of the box itself.
 */

/** A finished command in the whole draft, for the moment Send is pressed. */
/**
 * Whether a draft is a command that opens something rather than a message.
 *
 * A command with no `run` has nothing to turn into text, and sending it puts
 * its own name in the channel — which is the command appearing to do nothing
 * at all. Asked of the command rather than of its name, so one added later is
 * covered without anybody remembering to come back here.
 */
export function opensSomething(draft: string): SlashCommand | null {
  const found = commandInDraft(draft)
  return found && !found.cmd.run ? found.cmd : null
}

export function commandInDraft(
  draft: string,
): { cmd: SlashCommand; rest: string } | null {
  const m = /^\/([a-z]+)(?:[ \n]([\s\S]*))?$/i.exec(draft)
  if (!m) return null
  const cmd = SLASH.find((c) => c.name === (m[1] ?? '').toLowerCase())
  return cmd ? { cmd, rest: m[2] ?? '' } : null
}

/* ---------- formatting a selection ---------- */

export type Format = { id: string; label: string; marker: string; key: string }

export const FORMATS: readonly Format[] = [
  { id: 'bold', label: 'Bold', marker: '**', key: 'B' },
  { id: 'italic', label: 'Italic', marker: '*', key: 'I' },
  { id: 'underline', label: 'Underline', marker: '__', key: 'U' },
  { id: 'strike', label: 'Strikethrough', marker: '~~', key: 'S' },
  { id: 'code', label: 'Code', marker: '`', key: 'E' },
  { id: 'spoiler', label: 'Spoiler', marker: '||', key: 'H' },
]

/**
 * Whether a run of markers is this one's own pair.
 *
 * Wrapping and unwrapping have to agree about which marker owns a run of
 * stars, or italic applied to bold peels one star off and leaves a mess.
 */
function isOwnPair(run: string, marker: string): boolean {
  if (run.length < marker.length) return false
  if (run.length === marker.length) return true
  return !FORMATS.some((f) => f.marker.length > marker.length && f.marker === run)
}

/** Wrap the selection, or unwrap it if it is already wrapped in this. */
export function applyFormat(
  text: string,
  start: number,
  end: number,
  marker: string,
): { text: string; start: number; end: number } {
  const before = text.slice(0, start)
  const sel = text.slice(start, end)
  const after = text.slice(end)
  const runBefore = /[*~`|_]+$/.exec(before)?.[0] ?? ''
  const runAfter = /^[*~`|_]+/.exec(after)?.[0] ?? ''
  if (
    runBefore.endsWith(marker) && runAfter.startsWith(marker)
    && isOwnPair(runBefore, marker) && isOwnPair(runAfter, marker)
  ) {
    return {
      text: before.slice(0, -marker.length) + sel + after.slice(marker.length),
      start: start - marker.length,
      end: end - marker.length,
    }
  }
  return {
    text: before + marker + sel + marker + after,
    start: start + marker.length,
    end: end + marker.length,
  }
}
