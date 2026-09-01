/**
 * What to do once a friend request has been answered.
 *
 * The dialog used to stay open and put "Sent." under the box, which left
 * somebody to close it themselves and then go and find the request. Seeing it
 * sitting in Sent is the confirmation, so the box closes and that list opens.
 *
 * Written apart from the dialog because the decision is not obvious in one
 * case: asking somebody who has already asked you accepts *their* request, so
 * you are now friends and Sent is the one list it is certainly not in.
 */

export type RequestAnswer = {
  /** A refusal. Anything else is some flavour of success. */
  error?: string
  /** They had already asked you, so this accepted it. */
  accepted?: true
  /** Nothing to do: you are already friends, or you had already asked. */
  already?: 'friends' | 'asked'
}

export type AfterRequest =
  /** Say so and stay open: closing on a refusal says nothing about it. */
  | { kind: 'refused'; said: string }
  /** Close, and open the list the answer can be seen in. */
  | { kind: 'done'; tab: 'all' | 'sent' }

export function afterRequest(r: RequestAnswer | null | undefined): AfterRequest {
  if (r?.error) return { kind: 'refused', said: r.error }
  /* Now friends, either because this accepted their request or because you
     already were. Either way it is not something waiting to be answered. */
  if (r?.accepted || r?.already === 'friends') return { kind: 'done', tab: 'all' }
  return { kind: 'done', tab: 'sent' }
}
