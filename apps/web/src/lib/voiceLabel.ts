/**
 * The line under somebody's face in a call.
 *
 * One function because there are two places that draw it - the rows in the
 * sidebar and the faces on the stage - and they had already drifted: the
 * sidebar knew about sharing and the stage did not. Two copies of a list of
 * states is two lists, eventually.
 */
export function voiceLabel({ mine, deaf, muted, loud, sharing }: {
  /** Whether this face is your own, which is the only one deafness is known of. */
  mine?: boolean
  /** Whether *you* are deafened. Meaningless about anybody else - see below. */
  deaf?: boolean
  muted?: boolean
  /** Talking right now. */
  loud?: boolean
  sharing?: boolean
}): string {
  /*
   * Deafened first, because deafening mutes you as well and the stronger of
   * the two is the one worth saying. "Muted" under your own face while you
   * cannot hear a word anybody says understates it.
   *
   * Only ever about yourself. Whether somebody else has deafened is sent to
   * this client - it rides along in the voice occupancy - but nothing reads
   * it, so their row says Muted, which is at least true of them.
   */
  if (mine && deaf) return 'Deafened'
  if (muted) return 'Muted'
  if (loud) return 'Speaking'
  if (sharing) return 'Sharing'
  return 'Listening'
}
