import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One person, one name, wherever they are drawn.
 *
 * A nickname is what one server calls somebody, so every place that names a
 * person has to say which server it is asking about. There is a function for
 * that - nameIn - and the only way it stays true is if nothing writes the
 * name out by hand instead.
 *
 * This is not hypothetical tidiness. Before nicknames were per server there
 * were six hand-written copies of `nickname || display_name || username` and
 * a dozen places that skipped the nickname entirely, so the member list and
 * the voice tile beside it showed the same person under two names. Nobody
 * would have noticed until somebody used the feature.
 *
 * So: no file may compose a person's name itself. The exceptions are listed
 * here, by name and with a reason, which is the point - an exception you have
 * to write down is one somebody can argue with.
 */

const UI = join(__dirname, '..')

/**
 * Where a person's own name is the right answer, and why.
 *
 * Every one of these is somewhere with no server to have renamed anybody. A
 * conversation belongs to nobody; a friends list is not a server's; mutual
 * friends are a fact about two people. Adding to this list is allowed and
 * adding to it silently is what this test exists to stop.
 */
const OWN_NAME_IS_RIGHT: Record<string, string> = {
  'lib/names.ts': 'the function itself',
  'lib/dms.ts': 'a conversation belongs to nobody',
  'lib/watchers.ts': 'a list of ids resolved for a call, which may be a DM',
  'ui/Friends.tsx': 'your friends are yours, not a server’s',
  'ui/Home.tsx': 'your own name, to yourself',
  'ui/MePane.tsx': 'your own name, being edited',
  'ui/InvitePeople.tsx': 'friends, before any server is involved',
  'ui/NewGroup.tsx': 'people you are putting in a conversation',
  'ui/CallRow.tsx': 'a call row lives in a conversation',
  'ui/Avatar.tsx': 'the letter on a fallback picture, not a name',
  'ui/Spectators.tsx': 'takes a namer from whoever knows the room',
  'ui/Settings.tsx': 'the blocked list, which spans every server at once',
  'ui/Profile.tsx': 'mutual friends, which are nobody’s server',
  'ui/Shell.tsx': 'mutual friends, your own name, and a call ringing',
  'ui/Messages.tsx': 'the @ menu builds its own list from renderOptions',
  'ui/ServerSettings.tsx': 'the bans list names people who are not members,'
    + ' so no server has renamed them',
}

function files(dir: string, prefix = ''): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = join(dir, entry.name)
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...files(at, name))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push([name, readFileSync(at, 'utf8')])
    }
  }
  return out
}

/* Comments name the pattern on purpose - to warn the next person off it -
   and reading a file as one string cannot tell the warning apart from the
   thing it warns about. */
const codeOnly = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')

describe('nobody writes a person’s name out by hand', () => {
  it('except where their own name is the right answer', () => {
    const offenders: string[] = []
    for (const [name, text] of files(UI)) {
      if (name in OWN_NAME_IS_RIGHT) continue
      const code = codeOnly(text)
      /* The shape every one of them took: a display name with the username
         behind it, composed at the point of drawing. */
      if (/display_name\s*(\|\||\?\?)\s*[a-zA-Z_.?]*username/.test(code)) {
        offenders.push(name)
      }
    }
    expect(offenders, 'compose a name instead of calling nameIn').toEqual([])
  })

  /*
   * And the old shape cannot come back at all.
   *
   * `nickname || display_name` is the account-wide read that made one name
   * follow somebody into every server they were in. The field is gone from
   * the type, so this would not compile - but it is the exact line somebody
   * reaches for from memory, and a test that names it is a faster answer
   * than a type error three files away.
   */
  it('and nothing reads a nickname off a person at all', () => {
    /*
     * Its own exception, and only one.
     *
     * The list above is about composing a name; this is about the field
     * existing on a record at all, which is a stricter thing and needs a
     * stricter list. world.ts reads `e.nickname` off the frame that carries
     * a rename - which is the frame's field, not a person's, and is how the
     * per-server map is kept up to date in the first place.
     */
    const OFF_A_FRAME = new Set(['lib/world.ts'])
    const offenders: string[] = []
    for (const [name, text] of files(UI)) {
      if (OFF_A_FRAME.has(name)) continue
      if (/\.nickname\b/.test(codeOnly(text))) offenders.push(name)
    }
    expect(offenders, 'read a nickname off the record instead of world.nicknames').toEqual([])
  })

  /* The exception list has to describe files that exist, or it is a list of
     permissions nobody needs and one of them is hiding a real offender. */
  it('and the list of exceptions is all real', () => {
    const there = new Set(files(UI).map(([name]) => name))
    const gone = Object.keys(OWN_NAME_IS_RIGHT).filter((f) => !there.has(f))
    expect(gone, 'excused files that no longer exist').toEqual([])
  })
})
