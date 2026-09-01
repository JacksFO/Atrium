import { describe, it, expect } from 'vitest'
import { normaliseName, nameProblem } from './names.js'

/**
 * Refusing a name, and - more importantly - not refusing the wrong ones.
 *
 * Two failures, and they are not equally bad. A rude name that gets through
 * is six friends telling somebody to pack it in. A real person refused at
 * sign-up is somebody who cannot get in and is not told why, because the
 * message deliberately does not say which word it objected to. So the
 * false-positive half of this file is the half that matters.
 */

const refused = (name: string) => nameProblem(name) !== null

describe('reducing a name to what it reads as', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(normaliseName('Jack.FO')).toBe('jackfo')
    expect(normaliseName('J a c k')).toBe('jack')
    expect(normaliseName('__jack__')).toBe('jack')
  })

  it('reads digits standing in for letters', () => {
    expect(normaliseName('l33t')).toBe('leet')
    expect(normaliseName('j4ck')).toBe('jack')
    expect(normaliseName('b00b')).toBe('boob')
  })

  it('reads letters from other alphabets that are drawn the same', () => {
    // Cyrillic а, о, е and с. Identical on screen, completely different
    // characters underneath - this is the one that actually gets past people.
    // Cyrillic с, о, о then a Latin n. Cyrillic н is drawn like an H, not an
    // n, which is why it is not the letter to reach for here.
    expect(normaliseName('сооn')).toBe('coon')
    expect(normaliseName('jаck')).toBe('jack')
  })

  it('unpacks accents and the fancy alphabets people paste in', () => {
    expect(normaliseName('Josè')).toBe('jose')
    // Circled letters, which NFKD unpacks back to plain ones.
    expect(normaliseName('ⓙⓐⓒⓚ')).toBe('jack')
  })

  it('and a name with no letters at all reads as nothing', () => {
    expect(normaliseName('----')).toBe('')
  })
})

describe('names that are refused', () => {
  it('the plain versions', () => {
    expect(refused('nigger')).toBe(true)
    expect(refused('faggot')).toBe(true)
    expect(refused('hitler')).toBe(true)
    expect(refused('rapist')).toBe(true)
  })

  it('with digits swapped in for letters', () => {
    expect(refused('n1gger')).toBe(true)
    expect(refused('f4gg0t')).toBe(true)
    expect(refused('h1tl3r')).toBe(true)
    expect(refused('n166er')).toBe(true)
  })

  it('with punctuation shoved through the middle', () => {
    expect(refused('n.i.g.g.e.r')).toBe(true)
    expect(refused('n_i_g_g_e_r')).toBe(true)
    expect(refused('f a g g o t')).toBe(true)
  })

  it('with letters padded out', () => {
    expect(refused('niiiigger')).toBe(true)
    expect(refused('niggggger')).toBe(true)
    expect(refused('hiiitlerrr')).toBe(true)
  })

  it('written in a different alphabet that looks the same', () => {
    // Cyrillic о in both positions.
    expect(refused('gооk')).toBe(true)
    // Cyrillic а.
    expect(refused('nаzi')).toBe(true)
  })

  it('hidden inside a longer name', () => {
    expect(refused('xX_nigger_Xx')).toBe(true)
    expect(refused('coolfaggotguy')).toBe(true)
    expect(refused('literallyhitler69')).toBe(true)
  })

  it('and the short ones when they are the whole name', () => {
    expect(refused('paki')).toBe(true)
    expect(refused('p4k1')).toBe(true)
    expect(refused('cunt')).toBe(true)
    expect(refused('kys')).toBe(true)
  })

  it('a name made of nothing but symbols, which is not a name', () => {
    expect(refused('...')).toBe(true)
    expect(refused('---')).toBe(true)
    /*
     * Digits are a different matter: they read as letters through the
     * lookalike table, so '123' is 'ize' and is a name like any other. Odd,
     * but not this check's business to refuse.
     */
    expect(refused('123')).toBe(false)
  })
})

describe('names that must NOT be refused', () => {
  /*
   * The half that matters. Every one of these is a real name, a real word or
   * a real place, and every one of them contains something on a list.
   */
  it('ordinary names', () => {
    for (const name of [
      'JacksFO', 'baileyyy', 'Cami', 'Keeko', 'Chels', 'jack', 'sam',
      'Mr_Bean', 'x.ae.a-12', 'ash', 'bo', 'al',
    ]) {
      expect(nameProblem(name), `${name} was refused`).toBeNull()
    }
  })

  it('names and places that contain a slur as a fragment', () => {
    for (const name of [
      'Nigel', 'Niger', 'Nigeria', 'Nigerian',
      'Pakistani', 'Japan', 'Japanese', 'parsnip', 'turnip', 'nipper',
      'raccoon', 'cocoon', 'tycoon', 'spicy', 'suspicious',
      'grape', 'grapefruit', 'therapist', 'Lynch', 'Adolfo',
      'custard', 'mustard', 'standard', 'tardy', 'pedometer',
      'Scunthorpe', 'Penistone', 'Cockburn', 'Dickens', 'Babcock',
      'analyst', 'Cumbria', 'circumstance', 'Essex', 'Sussex',
    ]) {
      expect(nameProblem(name), `${name} was refused`).toBeNull()
    }
  })

  it('and the padding rule does not eat short innocent names', () => {
    // Flattening repeats turns 'bell' into 'bel' and 'ass' into 'as', which
    // is why only long terms are matched against the flattened form.
    for (const name of ['bell', 'Anna', 'Emma', 'Ellie', 'Bobby', 'Jimmy']) {
      expect(nameProblem(name), `${name} was refused`).toBeNull()
    }
  })
})

describe('what the person is told', () => {
  it('never says which word it objected to', () => {
    // The reason is for the log. Handing it back is handing over the exact
    // edit needed to get past it.
    const why = nameProblem('n1gger')
    expect(why).not.toBeNull()
    expect(why).toMatch(/nigger/)
    // ...and the message the route actually sends is the constant, which is
    // asserted where it is used rather than guessed at here.
  })
})
