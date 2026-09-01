import { ICONS, type IconName, type Shape } from './icons'

export type { IconName }

/**
 * One icon.
 *
 * The shapes come from a table and become real elements — there is no string
 * of markup anywhere in here, which is the whole point: an icon is the one
 * place it would be tempting to reach for dangerouslySetInnerHTML, and this
 * app does not have one.
 *
 * `aria-hidden` because every icon in this app sits beside a word or inside a
 * button that has a label. An icon that is announced on its own is a screen
 * reader saying "image" in the middle of a sentence.
 */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const shapes: readonly Shape[] = ICONS[name]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes.map((s, i) => {
        const { t, ...attrs } = s
        if (t === 'circle') return <circle key={i} {...attrs} />
        if (t === 'rect') return <rect key={i} {...attrs} />
        return <path key={i} {...attrs} />
      })}
    </svg>
  )
}
