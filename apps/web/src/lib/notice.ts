/**
 * What the home page says at the top, if anything.
 *
 * Changed here, in the source, and deployed - the same way the release notes
 * beside it are changed, and by the same person: whoever is running this
 * copy of the app.
 *
 * It is deliberately NOT a thing anybody can edit from inside the app. An
 * account that can write to everybody's home page is an owner, and this app
 * does not have one: nobody owns it, every account is another account, and
 * every server belongs to whoever made it. A box in the settings for one
 * privileged person would have been a quiet exception to the rule the whole
 * thing is built on.
 *
 * Null means there is nothing to say, and nothing is drawn. An empty card
 * announcing that there is no announcement is worse than the space.
 */
export type Notice = {
  title?: string
  body?: string
  /**
   * A picture, by URL.
   *
   * Anything the page can load: a file put in the client's public folder and
   * referenced as /whatever.png, or an address elsewhere. It is written here
   * rather than uploaded, so there is nothing for the orphan sweep to know
   * about and nothing to lose when a file is tidied away.
   */
  image?: string
  /**
   * Or the drawn one, like a server with no picture on it.
   *
   * A number, because that is what the drawing is made from - the same seed
   * gives the same picture for ever, so a notice does not change its look
   * every time somebody opens the page. Ignored when there is a real picture:
   * the drawn one is what stands in for not having chosen.
   */
  art?: number
  link?: string
  /** What the button says. "Open" if this is left out. */
  linkText?: string
}

export const NOTICE: Notice | null = {
  title: 'Atrium',
  body: 'Yours to run. Make a server, bring the people you actually talk to, '
    + 'and nobody else has a say in it.',
  art: 7,
}
