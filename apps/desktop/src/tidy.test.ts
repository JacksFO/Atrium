import { describe, expect, it } from 'vitest'
import { STALE_AFTER_MS, humanBytes, whatToTidy, type Leftover } from './tidy'

const NOW = 1_787_000_000_000
const MB = 1024 * 1024
const old = (days: number) => NOW - days * 24 * 60 * 60 * 1000

const file = (name: string, days: number, mb: number): Leftover =>
  ({ name, modified: old(days), bytes: mb * MB })

describe('what may be cleared from the updater cache', () => {
  /* The measurement that prompted this, as it was found on a real machine. */
  const asFound: Leftover[] = [
    file('Atrium-Setup-0.2.24.exe', 0, 99.7),
    file('installer.exe', 0, 99.7),
    file('package.7z', 2, 99.1),
    { name: 'current.blockmap', modified: old(0), bytes: 111_463 },
    { name: 'update-info.json', modified: old(0), bytes: 200 },
  ]

  it('leaves everything alone while an update is in flight', () => {
    expect(whatToTidy(asFound, NOW, true)).toEqual([])
  })

  /*
   * And leaves everything alone here too, because on that machine the old
   * file was only two days old. The saving is real but it is not urgent, and
   * a week of patience is cheaper than deleting an update somebody is about
   * to install.
   */
  it('and leaves a two-day-old leftover, which is not yet rubbish', () => {
    expect(whatToTidy(asFound, NOW, false)).toEqual([])
  })

  it('but takes it once it has sat there a week', () => {
    const later = NOW + STALE_AFTER_MS
    const names = whatToTidy(asFound, later, false).map((f) => f.name)
    expect(names).toContain('package.7z')
  })

  it('never the updater own bookkeeping, which is how it resumes', () => {
    const later = NOW + 30 * 24 * 60 * 60 * 1000
    const names = whatToTidy(asFound, later, false).map((f) => f.name)
    expect(names).not.toContain('update-info.json')
    expect(names).not.toContain('current.blockmap')
  })

  it('nor a latest.yml, whatever its age', () => {
    const files = [file('latest.yml', 90, 2)]
    expect(whatToTidy(files, NOW, false)).toEqual([])
  })

  /* Not worth the risk of touching somebody else's folder for a few KB. */
  it('nor anything too small to be worth the trouble', () => {
    const files = [{ name: 'scrap.tmp', modified: old(60), bytes: 4096 }]
    expect(whatToTidy(files, NOW, false)).toEqual([])
  })

  it('and hands them back biggest first', () => {
    const files = [
      file('small.exe', 40, 10),
      file('huge.7z', 40, 300),
      file('middling.exe', 40, 99),
    ]
    expect(whatToTidy(files, NOW, false).map((f) => f.name))
      .toEqual(['huge.7z', 'middling.exe', 'small.exe'])
  })

  it('and copes with an empty folder', () => {
    expect(whatToTidy([], NOW, false)).toEqual([])
  })

  /* The boundary, both sides of it, because "older than a week" is the whole
     rule and off-by-one here means deleting an update in progress. */
  it('is exact about a week', () => {
    const justUnder = [{ name: 'a.exe', modified: NOW - STALE_AFTER_MS, bytes: 50 * MB }]
    const justOver = [{ name: 'a.exe', modified: NOW - STALE_AFTER_MS - 1, bytes: 50 * MB }]
    expect(whatToTidy(justUnder, NOW, false)).toEqual([])
    expect(whatToTidy(justOver, NOW, false)).toHaveLength(1)
  })
})

describe('saying how much was freed', () => {
  it('reads the way a person would say it', () => {
    expect(humanBytes(300)).toBe('300 bytes')
    expect(humanBytes(4096)).toBe('4 KB')
    expect(humanBytes(99 * MB)).toBe('99 MB')
    expect(humanBytes(1.5 * 1024 * MB)).toBe('1.5 GB')
  })
})
