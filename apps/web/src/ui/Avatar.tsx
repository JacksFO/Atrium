import { AvatarArt } from './Scene'
import { useState } from 'react'
import { Still } from './Still'
import type { Status } from '../lib/presence'
import type { User } from '../lib/wire'

/** A number from an id, only ever to seed a picture. Never an identity. */
export function seedOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % 2147483647 || 1
}

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'hu'

/**
 * Somebody's face.
 *
 * The picture they chose, or the art drawn from their id — the generated one
 * is the default rather than a placeholder, so an account with no picture
 * still looks like itself rather than like an empty circle.
 */
export function Avatar({ user, size = 'md' }: { user: Pick<User, 'id' | 'display_name' | 'avatar_path'>; size?: AvatarSize }) {
  const letter = (user.display_name || '?').slice(0, 1).toUpperCase()
  /*
   * A picture that will not load falls back to the drawn one.
   *
   * The row said what somebody's picture is, and that was taken as proof the
   * picture exists. When the file is gone the browser draws its own broken
   * image - a torn page and the alt text - which is the ugliest possible
   * answer to a question the app already knows a good answer to.
   *
   * It is not hypothetical: a file can be swept, a restore can be partial, an
   * upload can fail after the row was written. Reset when the path changes,
   * so somebody putting a new picture on is not told their old one is broken.
   */
  const [broken, setBroken] = useState<string | null>(null)
  const missing = !!user.avatar_path && broken === user.avatar_path

  if (user.avatar_path && !missing) {
    return (
      <span className={`av ${size} pic`}>
        <Still path={user.avatar_path} onMissing={() => setBroken(user.avatar_path)} />
      </span>
    )
  }
  return (
    <span className={`av ${size}`}>
      <AvatarArt seed={seedOf(user.id)} />
      <span>{letter}</span>
    </span>
  )
}

/**
 * A face with how they are, on it.
 *
 * One dot, drawn here and nowhere else. Drawing a second one alongside is how
 * a profile card ended up with two, three pixels apart.
 */
export function AvatarWithStatus({ user, status, size = 'md' }: {
  user: Pick<User, 'id' | 'display_name' | 'avatar_path'>
  status: Status
  size?: AvatarSize
}) {
  return (
    <span className="avw">
      <Avatar user={user} size={size} />
      <span className={status === 'online' ? 'st' : `st ${status}`} />
    </span>
  )
}
