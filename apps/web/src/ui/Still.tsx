import { useStillWhenAway } from '../lib/usestill'

/**
 * A picture somebody chose, which holds still when nobody is looking.
 *
 * An animated avatar keeps decoding frames whether or not anybody is looking
 * at it, and a member list is thirty of them. Pausing an animation is a CSS
 * property; pausing a GIF is not — there is no property for it, so the first
 * frame is drawn to a canvas and shown instead until somebody comes back.
 *
 * A picture that cannot animate gets none of this: no listener, no canvas, no
 * second render. That is most of them.
 */
export function Still({ path, className, alt = '', onMissing }: {
  /** The stored path, as the server gave it, signature and all. */
  path: string
  className?: string
  alt?: string
  /** The file is not there. Whoever asked for the picture decides what to
   *  draw instead - this only reports it, and only once per address. */
  onMissing?: () => void
}) {
  /* Same-origin here, so the path is the address. */
  const still = useStillWhenAway(path, path)
  return (
    <img ref={still.img} className={className} src={still.src} alt={alt}
      onError={onMissing} />
  )
}
