import { useRef, useState } from 'react'
import { Icon } from './Icon'
import { Menu } from './Menu'

/**
 * A choice from a short list, drawn by the app.
 *
 * A bare `<select>` is the operating system's control: it ignores every
 * colour in here, and the list it opens is drawn by Windows in Windows'
 * shape. One of those in the middle of a settings pane looks like a piece of
 * another program that has fallen into this one.
 *
 * Built on the same menu as every right-click, so it is placed, dismissed and
 * escaped by code that already works, and looks like the rest of the app for
 * the same reason.
 *
 * For a handful of options. A long list wants searching, and a menu of forty
 * rows is a scrollbar in a popup - which is the one case a native select is
 * genuinely better at.
 *
 * Its class is `chooser` and not `picker`, which this stylesheet has already
 * given to the emoji panel - `position:absolute; bottom:100%`, which made
 * this button vanish rather than look wrong. See short-class-names-collide.
 */
export function Picker<T extends string | number>({
  value, options, onPick, label,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onPick: (value: T) => void
  /** What the choice is called, for anybody who cannot see it beside. */
  label: string
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const now = options.find((o) => o.value === value)

  return (
    <>
      <button ref={button} className="chooser" aria-label={label}
        onClick={() => {
          /* Under the button rather than at the pointer: this is a control in
             a fixed place, not a menu about wherever you happened to click. */
          const box = button.current?.getBoundingClientRect()
          setAt({ x: box?.left ?? 0, y: (box?.bottom ?? 0) + 4 })
        }}>
        <span>{now?.label ?? String(value)}</span>
        <Icon name="chev" size={14} />
      </button>
      {at && (
        <Menu
          x={at.x} y={at.y}
          onClose={() => setAt(null)}
          items={options.map((o) => ({
            kind: 'item' as const,
            label: o.label,
            /* A tick on the one in force, so an open menu says which it is
               rather than only offering to change it. Spread rather than set
               to undefined: an absent property and one holding undefined are
               different things to this compiler. */
            ...(o.value === value ? { icon: 'check' as const } : {}),
            onPick: () => { setAt(null); onPick(o.value) },
          }))}
        />
      )}
    </>
  )
}
