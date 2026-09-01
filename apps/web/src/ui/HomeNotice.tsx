import { Icon } from './Icon'
import { Scene } from './Scene'
import { NOTICE } from '../lib/notice'

/**
 * One notice at the top of the home page.
 *
 * Written in the source and deployed, not typed into a box by somebody with
 * a switch nobody else has.
 *
 * The first version of this had a table, three routes and an editor, gated
 * behind the instance owner - which quietly invented exactly the thing this
 * app is built not to have. Nobody owns Atrium; every account is another
 * account, and every server is somebody's own. An account that can write to
 * everybody's home page is an owner however carefully the word is avoided.
 *
 * So it is a constant, changed the way the release notes beside it are
 * changed: by whoever is deploying, in a commit, visible to anybody reading
 * the repository. That is the same authority as changing anything else here,
 * which is the point - it is not a new power, it is the existing one.
 */
export function HomeNotice() {
  const notice = NOTICE
  if (!notice) return null

  return (
    <div className="notice">
      {/* A picture if one was chosen, otherwise the drawn one - the same
          thing a server with no icon shows, from the same painter. Neither
          if the notice asks for neither. */}
      {notice.image
        ? (
          <div className="notice-pic">
            <img src={notice.image} alt="" />
          </div>
        )
        : notice.art !== undefined && (
          <div className="notice-pic art">
            <Scene seed={notice.art} height={132} />
          </div>
        )}
      <div className="notice-txt">
        {notice.title && <h3>{notice.title}</h3>}
        {notice.body && <p>{notice.body}</p>}
        {notice.link && (
          /* Opened away from the app, and told not to hand the app over with
             it — the same rule every other outbound link here follows. */
          <a className="btn p notice-go" href={notice.link}
            target="_blank" rel="noreferrer noopener">
            {notice.linkText || 'Open'}
            <Icon name="up" size={13} />
          </a>
        )}
      </div>
    </div>
  )
}
