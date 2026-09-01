/**
 * What the update banner is showing, and how it changes.
 *
 * Kept out of the component because both faults it had were faults in this
 * bit of reasoning rather than in any markup. The downloading stage was never
 * entered, so a download that was reporting its progress perfectly well had
 * nowhere to show it - the banner sat on one line for the whole thing. And
 * everything here was driven by one-shot events, in a component that does not
 * exist until somebody has signed in, so news that arrived first was news
 * nobody ever heard.
 *
 * A shape that can be handed a state and an event and asked what happens next
 * is a shape that can be asked about all of that in a test.
 */

export type UpdateStage = 'idle' | 'available' | 'downloading' | 'ready' | 'error'

export type UpdateState = {
  stage: UpdateStage
  version: string
  percent: number
  error: string
  /** Waved away by the reader. Real news brings it back. */
  dismissed: boolean
}

export const NO_UPDATE: UpdateState = {
  stage: 'idle', version: '', percent: 0, error: '', dismissed: false,
}

type Payload =
  | { version?: string; percent?: number }
  /** The catch-up seed, which carries a whole remembered state. */
  | Partial<UpdateState>
  | string
  | undefined

/**
 * The next state, given what the updater just said.
 *
 * `state` is the catch-up event: the shell remembering what it announced
 * before this was listening, which is how an update downloaded in a previous
 * session gets mentioned again.
 */
export function nextUpdate(current: UpdateState, event: string, payload?: Payload): UpdateState {
  const asObject = (payload ?? {}) as { version?: string; percent?: number }

  switch (event) {
    case 'state': {
      const seed = (payload ?? {}) as Partial<UpdateState>
      if (!seed.stage || seed.stage === 'idle') return current
      return {
        stage: seed.stage,
        version: seed.version ?? '',
        percent: seed.percent ?? 0,
        error: seed.error ?? '',
        // Catching up is not new news, so it does not override a reader who
        // has already waved this very thing away.
        dismissed: current.dismissed && current.version === (seed.version ?? ''),
      }
    }

    case 'available':
      return { ...current, stage: 'available', version: asObject.version ?? '', dismissed: false }

    /*
     * Progress means it is downloading, which nothing used to say. Never
     * backwards from ready: a late progress frame after the download finished
     * would otherwise take the Restart button away again.
     */
    case 'progress':
      if (current.stage === 'ready') return { ...current, percent: 100 }
      return { ...current, stage: 'downloading', percent: asObject.percent ?? 0, dismissed: false }

    case 'ready':
      return {
        ...current,
        stage: 'ready',
        version: asObject.version ?? current.version,
        percent: 100,
        // Worth saying again even to somebody who waved the download away:
        // this is the point where one click finishes it.
        dismissed: false,
      }

    case 'error':
      // An update already downloaded is unaffected by a later check failing.
      if (current.stage === 'ready') return current
      return {
        ...current,
        stage: 'error',
        error: typeof payload === 'string' ? payload : 'update failed',
      }

    case 'none':
      // Only forget an update we were told about. One already downloaded is
      // still sitting there whatever a later check says.
      return current.stage === 'ready' ? current : NO_UPDATE

    case 'dismiss':
      return { ...current, dismissed: true }

    case 'download':
      return { ...current, stage: 'downloading', percent: 0, dismissed: false }

    default:
      return current
  }
}

/** Whether there is anything worth putting on screen. */
export function showUpdate(state: UpdateState): boolean {
  return state.stage !== 'idle' && !state.dismissed
}

/**
 * Whether starting a download by hand would mean anything here.
 *
 * Only after a failure. The download starts on its own, so a button during
 * the normal path would be a button for something already happening - and
 * asking "would you like the new version" is a question with one answer.
 * After a failure there is a real decision: try again now, or wait an hour
 * for the next check.
 */
export function canDownload(state: UpdateState): boolean {
  return state.stage === 'error'
}
