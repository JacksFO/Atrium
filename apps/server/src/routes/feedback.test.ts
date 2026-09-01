import { describe, expect, it } from 'vitest'
import { isKind, titleOf, REPORT_MAX } from './feedback.js'

/**
 * The parts of a report that are a decision rather than a database write.
 */

describe('what somebody says it is', () => {
  it('is one of the two things offered', () => {
    expect(isKind('feedback')).toBe(true)
    expect(isKind('bug')).toBe(true)
  })

  it('and nothing else, whatever arrives', () => {
    /* The label goes on an issue, so anything accepted here is something a
       stranger can put on our tracker. */
    for (const v of ['urgent', 'BUG', '', 'bug ', 42, null, undefined, {}]) {
      expect(isKind(v), String(v)).toBe(false)
    }
  })
})

describe('the line an issue is titled with', () => {
  it('is the report, when it is short', () => {
    expect(titleOf('the mute button does nothing')).toBe('the mute button does nothing')
  })

  it('is the first line, when there are several', () => {
    /* Somebody types the summary and then the detail. The summary is the
       first thing they wrote, which is what a title wants. */
    expect(titleOf('cannot join voice\nit spins and stops')).toBe('cannot join voice')
  })

  it('and is trimmed of the space around it', () => {
    expect(titleOf('   spaces everywhere   ')).toBe('spaces everywhere')
  })

  it('falls back to the whole thing when the first line is empty', () => {
    expect(titleOf('\n\nit crashed')).toBe('it crashed')
  })

  it('and is cut short rather than being a paragraph', () => {
    const long = 'x'.repeat(REPORT_MAX)
    const title = titleOf(long)
    expect(title.length).toBeLessThanOrEqual(72)
    expect(title.endsWith('…'), 'says it was cut').toBe(true)
  })

  it('though a report at the limit still fits in one', () => {
    /* Two hundred characters is the most anybody can send, and a title of
       seventy-two is not a lie about it - the whole report is stored. */
    expect(REPORT_MAX).toBe(200)
  })
})
