import { Modal } from './Modal'

/**
 * What the keyboard can do, said somewhere somebody can find it.
 *
 * A shortcut nobody knows about may as well not exist, and there is nowhere
 * else in an app for that list to live - a menu item saying "keyboard
 * shortcuts" is read once, and this is what it opens.
 *
 * The list is written here rather than gathered from the handlers. Gathering
 * it would be honest and unreadable: what a reader needs is "Ctrl K — go to a
 * channel", and a handler knows the key without knowing the sentence. The
 * risk is that the two drift, so there is a test holding the two together on
 * the keys that matter.
 */

/** Ctrl on Windows and Linux, Command on a Mac, drawn the way each is read. */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  ? '⌘'
  : 'Ctrl'

type Row = readonly [keys: string[], what: string]

const GETTING_ABOUT: readonly Row[] = [
  [[MOD, 'K'], 'Go to a channel, a conversation or a server'],
  [[MOD, '1'], 'The first server — and 2 to 9 for the rest'],
  [['Alt', '↑'], 'The channel above'],
  [['Alt', '↓'], 'The channel below'],
  [[MOD, 'F'], 'Search everything you can read'],
  [['Esc'], 'Close whatever is open'],
]

const WRITING: readonly Row[] = [
  [['Enter'], 'Send'],
  [['Shift', 'Enter'], 'A new line without sending'],
  [['↑'], 'Edit the last thing you said, with the box empty'],
  [[MOD, 'B'], 'Bold'],
  [[MOD, 'I'], 'Italic'],
  [[MOD, 'U'], 'Underline'],
  [[MOD, 'Shift', 'X'], 'Strikethrough'],
  [[MOD, 'Shift', 'S'], 'Spoiler'],
]

const THE_REST: readonly Row[] = [
  [[MOD, '/'], 'This list'],
]

const GROUPS: ReadonlyArray<readonly [string, readonly Row[]]> = [
  ['Getting about', GETTING_ABOUT],
  ['Writing', WRITING],
  ['Everything else', THE_REST],
]

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Keyboard shortcuts"
      onClose={onClose}
      actions={<button className="btn" onClick={onClose}>Close</button>}
    >
      <div className="keys">
        {GROUPS.map(([heading, rows]) => (
          <section key={heading}>
            <h4>{heading}</h4>
            <dl>
              {rows.map(([keys, what]) => (
                <div className="keys-row" key={what}>
                  <dt>
                    {keys.map((k) => <kbd key={k}>{k}</kbd>)}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  )
}
