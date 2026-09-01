import { describe, it, expect } from 'vitest'
import { nextUpdate, showUpdate, canDownload, NO_UPDATE, type UpdateState } from './updates'

const after = (events: Array<[string, unknown?]>, from: UpdateState = NO_UPDATE) =>
  events.reduce((s, [event, payload]) => nextUpdate(s, event, payload as never), from)

describe('following an update from announcement to installed', () => {
  it('shows nothing until there is something to say', () => {
    expect(showUpdate(NO_UPDATE)).toBe(false)
  })

  it('names the version when one is found', () => {
    const s = nextUpdate(NO_UPDATE, 'available', { version: '0.2.15' })
    expect(s.stage).toBe('available')
    expect(s.version).toBe('0.2.15')
    expect(showUpdate(s)).toBe(true)
  })

  it('enters the downloading stage on the first progress', () => {
    // This is the bug: progress arrived, the percentage was recorded, and the
    // stage never moved - so the percentage had nowhere to show and the
    // banner sat on one line for the whole download.
    const s = after([['available', { version: '0.2.15' }], ['progress', { percent: 12 }]])
    expect(s.stage).toBe('downloading')
    expect(s.percent).toBe(12)
  })

  it('follows the percentage up', () => {
    const s = after([
      ['available', { version: '0.2.15' }],
      ['progress', { percent: 12 }],
      ['progress', { percent: 74 }],
    ])
    expect(s.percent).toBe(74)
  })

  it('ends at ready, at a hundred percent', () => {
    const s = after([
      ['available', { version: '0.2.15' }],
      ['progress', { percent: 74 }],
      ['ready', { version: '0.2.15' }],
    ])
    expect(s.stage).toBe('ready')
    expect(s.percent).toBe(100)
  })

  it('does not fall back out of ready on a late progress frame', () => {
    // Otherwise the Restart button vanishes again a moment after appearing.
    const s = after([['ready', { version: '0.2.15' }], ['progress', { percent: 99 }]])
    expect(s.stage).toBe('ready')
  })
})

describe('waving it away', () => {
  it('hides it', () => {
    const s = after([['available', { version: '0.2.15' }], ['dismiss']])
    expect(showUpdate(s)).toBe(false)
  })

  it('but a finished download says so again, because one click ends it', () => {
    const s = after([
      ['available', { version: '0.2.15' }],
      ['dismiss'],
      ['ready', { version: '0.2.15' }],
    ])
    expect(showUpdate(s)).toBe(true)
  })

  it('and so does a download actually starting', () => {
    const s = after([
      ['available', { version: '0.2.15' }],
      ['dismiss'],
      ['progress', { percent: 5 }],
    ])
    expect(showUpdate(s)).toBe(true)
  })
})

describe('catching up on news it was not there to hear', () => {
  /*
   * The banner lives in the chat view, which does not exist until somebody
   * has signed in - and the first check runs eight seconds after launch. So
   * an update found on the sign-in screen was announced to nobody.
   */
  it('picks up an update found before it was listening', () => {
    const s = nextUpdate(NO_UPDATE, 'state',
      { stage: 'available', version: '0.2.15', percent: 0, error: '' })
    expect(s.stage).toBe('available')
    expect(showUpdate(s)).toBe(true)
  })

  it('picks up one downloaded in a previous session', () => {
    // Sitting there ready to install, its event fired in a session that has
    // since ended, and nothing ever mentioned it again.
    const s = nextUpdate(NO_UPDATE, 'state',
      { stage: 'ready', version: '0.2.15', percent: 100, error: '' })
    expect(s.stage).toBe('ready')
    expect(showUpdate(s)).toBe(true)
  })

  it('says nothing when there is nothing to catch up on', () => {
    expect(nextUpdate(NO_UPDATE, 'state', { stage: 'idle' })).toEqual(NO_UPDATE)
    expect(nextUpdate(NO_UPDATE, 'state', undefined)).toEqual(NO_UPDATE)
  })

  it('does not undo a dismissal of the very same version', () => {
    const dismissed = after([['available', { version: '0.2.15' }], ['dismiss']])
    const s = nextUpdate(dismissed, 'state',
      { stage: 'available', version: '0.2.15', percent: 0, error: '' })
    expect(showUpdate(s)).toBe(false)
  })

  it('but does surface a different version they have not seen', () => {
    const dismissed = after([['available', { version: '0.2.15' }], ['dismiss']])
    const s = nextUpdate(dismissed, 'state',
      { stage: 'available', version: '0.2.16', percent: 0, error: '' })
    expect(showUpdate(s)).toBe(true)
  })
})

describe('when it goes wrong', () => {
  it('says so, and offers a download by hand', () => {
    const s = nextUpdate(NO_UPDATE, 'error', 'net::ERR_CONNECTION_RESET')
    expect(s.stage).toBe('error')
    expect(s.error).toBe('net::ERR_CONNECTION_RESET')
    expect(canDownload(s)).toBe(true)
  })

  it('does not throw away an update that is already downloaded', () => {
    // A later check failing says nothing about the copy already on disk.
    const s = after([['ready', { version: '0.2.15' }], ['error', 'check failed']])
    expect(s.stage).toBe('ready')
  })

  it('has something to say even without a message', () => {
    expect(nextUpdate(NO_UPDATE, 'error').error).toBe('update failed')
  })
})

describe('being told there is nothing new', () => {
  it('clears an announcement that has gone away', () => {
    const s = after([['available', { version: '0.2.15' }], ['none']])
    expect(showUpdate(s)).toBe(false)
  })

  it('but leaves a downloaded update alone, because it is still waiting', () => {
    const s = after([['ready', { version: '0.2.15' }], ['none']])
    expect(s.stage).toBe('ready')
    expect(showUpdate(s)).toBe(true)
  })
})

describe('starting a download by hand', () => {
  /*
   * Only after a failure. The download starts on its own, so a button in the
   * normal path would be a button for something already happening - and
   * "would you like the new version" is a question with one answer.
   */
  it('is offered after a failure, where there is a real decision', () => {
    expect(canDownload(nextUpdate(NO_UPDATE, 'error', 'timed out'))).toBe(true)
  })

  it('is not offered on the announcement, which downloads itself', () => {
    expect(canDownload(nextUpdate(NO_UPDATE, 'available', { version: '0.2.15' }))).toBe(false)
  })

  it('is not offered while one is already running', () => {
    expect(canDownload(nextUpdate(NO_UPDATE, 'progress', { percent: 30 }))).toBe(false)
  })

  it('is not offered once it is ready to install', () => {
    expect(canDownload(nextUpdate(NO_UPDATE, 'ready', { version: '0.2.15' }))).toBe(false)
  })

  it('moves straight into downloading when asked', () => {
    const s = after([['error', 'timed out'], ['download']])
    expect(s.stage).toBe('downloading')
    expect(s.percent).toBe(0)
  })
})
