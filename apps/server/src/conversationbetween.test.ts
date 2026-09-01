import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, conversationBetween, joinContainer } from './db.js'

/**
 * The conversation between two people.
 *
 * Written out four times before this, in three files, in two forms - and the
 * difference mattered: one insisted the conversation had exactly two people
 * in it, three did not. Nobody notices that kind of divergence, because all
 * four agree until a malformed row exists and then they disagree about which
 * one is real.
 *
 * The strict version is the one that survived, because it says what a `dm`
 * is: a pair. More people than that is a group and has its own kind.
 */
const anna = randomUUID(), bob = randomUUID(), carol = randomUUID()
let pair = '', group = '', crowded = ''

function user(id: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
}

function talk(kind: 'dm' | 'group', people: string[]) {
  const id = randomUUID()
  db.prepare("INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, '', ?, 0, ?)")
    .run(id, kind, Date.now())
  for (const who of people) {
    joinContainer(who, id)
  }
  return id
}

beforeAll(() => {
  for (const id of [anna, bob, carol]) user(id)
  pair = talk('dm', [anna, bob])
  group = talk('group', [anna, carol])
  /* A 'dm' with three people in it: the malformed row the strict check is
     for. Nothing makes one today; the point is what happens if anything does. */
  crowded = talk('dm', [bob, carol, anna])
})

describe('finding the conversation between two people', () => {
  it('finds the pair they are in', () => {
    expect(conversationBetween(anna, bob)).toBe(pair)
  })

  it('and finds it whichever way round they are asked for', () => {
    expect(conversationBetween(bob, anna)).toBe(pair)
  })

  it('but not a group they happen to share', () => {
    /* A group is a conversation, and it is not this one. */
    expect(conversationBetween(anna, carol)).not.toBe(group)
  })

  it('and not a "dm" with more than two people in it', () => {
    /* The check three of the four copies were missing. Bob and Carol share
       only the crowded row, so a lookup that ignored the count would return
       it and call it their private conversation. */
    expect(conversationBetween(bob, carol)).toBeNull()
    expect(crowded).toBeTruthy()
  })

  it('and nothing for two people who share none', () => {
    const stranger = randomUUID()
    user(stranger)
    expect(conversationBetween(anna, stranger)).toBeNull()
  })
})
