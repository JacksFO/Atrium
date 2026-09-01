import { useCallback, useEffect, useMemo, useState } from 'react'
import { Over } from './Over'
import {
  hasRules, rulesBody, verdictOf, verdictsFor,
  type ChannelRules, type Verdict,
} from '../lib/overrides'
import { loadMembers } from '../lib/load'
import { nameIn } from '../lib/names'
import { CHANNEL_PERMISSIONS, permissionMeta, VOICE_PERMISSIONS, VOICE_LABELS } from '../lib/permissions'
import { inRankOrder, roleColour } from '../lib/roles'
import type { Api } from '../lib/api'
import type { Id, Space, User } from '../lib/wire'
import type { World } from '../lib/world'
import { Icon, type IconName } from './Icon'
import { useEscape } from './useEscape'

/**
 * What one channel says, over and above what the server already allows.
 *
 * Three states per permission and no fourth: allow, refuse, or say nothing —
 * and saying nothing is the *absence* of a rule rather than a rule meaning
 * "default", so only what somebody actually decided is stored. A panel with
 * two states cannot express "I have not decided this", which is what nearly
 * every permission is, and saving one would turn all the others into
 * refusals.
 */
/**
 * What one channel — or one heading — says over and above the server.
 *
 * The two are the same panel because they are the same question asked of a
 * different row, and the server answers both from routes of the same shape.
 * Written for channels alone it was a heading's permissions being absent
 * although the route for them had always existed.
 */
export type PermTarget =
  | { what: 'channels'; id: Id; name: string; kind: 'text' | 'voice' }
  | { what: 'categories'; id: Id; name: string }

/** A role or a person: the two things a rule can be about. */
type Subject = { kind: 'role' | 'member'; id: Id }

const key = (s: Subject) => `${s.kind}:${s.id}`
const same = (a: Subject | null, b: Subject) =>
  Boolean(a) && a!.kind === b.kind && a!.id === b.id

export function ChannelPerms({ server, world, space, target, onClose }: {
  server: Api
  world: World
  space: Space
  target: PermTarget
  onClose: () => void
}) {
  /* Escape shuts it, like everything else that opens over the app. The
     panel this replaced listened for it and this one did not: the way out
     was the mouse or nothing. */
  useEscape(onClose, true)

  const [rules, setRules] = useState<ChannelRules | null>(null)
  const [said, setSaid] = useState('')
  const [subject, setSubject] = useState<Subject | null>(null)
  const [people, setPeople] = useState<User[]>([])
  const [adding, setAdding] = useState(false)
  /**
   * Added here, but not given a rule yet.
   *
   * A subject with nothing decided has nothing to store, so it would vanish
   * the moment the panel read itself back. Held on screen until something is
   * set, which is what makes "add the role, then start deciding" work at all.
   */
  const [pending, setPending] = useState<Subject[]>([])

  const where = `/api/${target.what}/${encodeURIComponent(target.id)}/permissions`

  const load = useCallback(() => {
    void server.get<ChannelRules>(where)
      .then(setRules)
      .catch((e: unknown) => setSaid(e instanceof Error ? e.message : 'Those would not load.'))
  }, [server, where])

  useEffect(load, [load])

  /* Everybody in the server, which nothing else here has: what arrives on
     the way in is you, your friends and whoever you have a conversation
     with, so a member list has to be asked for. */
  useEffect(() => {
    /* The names this server gives them come with the list; they are read
       from the world, which loadSpace has already filled for this server. */
    void loadMembers(server, space.id).then((r) => setPeople(r.members))
      .catch(() => setPeople([]))
  }, [server, space.id])

  const roles = inRankOrder(world.roles.filter((r) => r.space_id === space.id))
  const everyone = roles.find((r) => r.kind === 'everyone')

  /**
   * Who the left-hand column lists.
   *
   * @everyone first and always, because it is the row that decides what the
   * channel is like for somebody with nothing special about them — and a
   * column that listed only exceptions would have no way to make one. Then
   * whoever has a rule here, then whoever was added a moment ago.
   *
   * Not every role in the server: twenty roles listed to hold two rules is a
   * list you have to read rather than one you can see.
   */
  const subjects = useMemo(() => {
    const seen = new Set<string>()
    const out: Subject[] = []
    const add = (s: Subject) => {
      if (seen.has(key(s))) return
      seen.add(key(s))
      out.push(s)
    }
    if (everyone) add({ kind: 'role', id: everyone.id })
    for (const o of rules?.overrides ?? []) add({ kind: o.kind, id: o.subjectId })
    for (const p of pending) add(p)
    return out
  }, [rules, pending, everyone])

  const chosen = subject ?? subjects[0] ?? null
  const verdicts = rules && chosen
    ? verdictsFor(rules.overrides, chosen.kind, chosen.id)
    : new Map<string, Verdict>()

  const nameOf = (s: Subject): { name: string; colour: string | null } => {
    if (s.kind === 'role') {
      const r = roles.find((x) => x.id === s.id)
      return { name: r?.name ?? 'a role that is gone', colour: roleColour(r) }
    }
    const m = people.find((x) => x.id === s.id)
    return {
      name: m ? nameIn(world, space.id, m) : 'somebody who left',
      colour: null,
    }
  }

  /*
   * A voice room has no opinion about most of them — a switch for attaching
   * files in a room with no messages in it is a switch about nothing.
   *
   * A heading is asked about all of them, because it stands for whatever is
   * under it and that is usually both kinds.
   */
  const voice = target.what === 'channels' && target.kind === 'voice'
  const asked = voice ? VOICE_PERMISSIONS : CHANNEL_PERMISSIONS

  /* The same permission, under the word for it in this kind of room. Sending
     a message and speaking are one rule and two nouns. */
  const named = (id: string) => (voice && VOICE_LABELS[id as keyof typeof VOICE_LABELS])
    ? VOICE_LABELS[id as keyof typeof VOICE_LABELS]!
    : permissionMeta(id)

  /**
   * Write one subject's rules, all of them, rather than the row that moved.
   *
   * That is the shape the route takes, and it is what makes clearing one
   * unambiguous: send nothing and the subject goes back to inheriting, with
   * no stale row left behind quietly saying yes.
   */
  const put = (s: Subject, next: Map<string, Verdict>) =>
    server.put(where, { kind: s.kind, subjectId: s.id, rules: rulesBody(next) })
      .then(() => { setSaid(''); load() })
      .catch((e: unknown) => setSaid(e instanceof Error ? e.message : 'That would not save.'))

  const write = (next: Map<string, Verdict>) => {
    if (!chosen) return
    /* Stored now, so it no longer needs holding on screen. */
    setPending((p) => p.filter((x) => !same(chosen, x)))
    void put(chosen, next)
  }

  /**
   * Take a role or a person back off this channel.
   *
   * Reported from real use: adding somebody was one click and removing them
   * was not possible at all. The nearest thing was putting every row back on
   * the middle one at a time — which does leave no rules behind, and so is
   * the same removal, but nothing on screen said so.
   */
  const remove = (s: Subject) => {
    setPending((p) => p.filter((x) => !same(s, x)))
    setSubject((cur) => (cur && same(cur, s) ? null : cur))
    if (!rules || !hasRules(rules.overrides, s.kind, s.id)) return
    void put(s, new Map())
  }

  const setSynced = (on: boolean) => {
    void server.post<ChannelRules>(`${where}/sync`, { synced: on })
      .then(setRules)
      .catch((e: unknown) => setSaid(e instanceof Error ? e.message : 'That would not save.'))
  }

  const taken = new Set(subjects.map(key))
  const freeRoles = roles.filter((r) => r.kind !== 'owner' && !taken.has(`role:${r.id}`))
  const freePeople = people.filter((m) => !taken.has(`member:${m.id}`))

  return (
    <Over>
      <div className="scrim" onClick={onClose} />
      {/*
        * Says out loud whether the rules have arrived.
        *
        * The subjects and the rows draw from the roles the app already has,
        * so the panel looks complete a moment before it knows anything —
        * every row in the middle, no sync banner. A fine half-second for a
        * person, and a trap for a test, which reads it and believes it.
        */}
      <div
        className="modal wide"
        role="dialog"
        aria-label={`${target.name} permissions`}
        data-loaded={rules ? '1' : '0'}
      >
        <div className="mhd">
          <span className="t">
            <Icon
              name={target.what === 'categories' ? 'layers'
                : target.kind === 'voice' ? 'vol' : 'hash'}
              size={16}
            /> {target.name}
          </span>
          <span className="gw" />
          <button className="icb" onClick={onClose} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="mbd">
          {/* Only a channel under a heading can be following one. A loose
              channel has nothing above it, so the banner would say nothing. */}
          {target.what === 'channels' && rules?.category && (
            <div className="perm-sync">
              <span>
                {rules.synced
                  ? <>Permissions synced with category: <b>{rules.category.name}</b>. Changing
                    anything here stops that, and this channel keeps what it has now.</>
                  : <>Set separately from <b>{rules.category.name}</b>.</>}
              </span>
              <button className="btn" onClick={() => setSynced(!rules.synced)}>
                {rules.synced ? 'Set separately' : 'Follow the category'}
              </button>
            </div>
          )}

          <div className="perm-cols">
            <div className="perm-subjects">
              <div className="perm-h">
                <span>Roles and people</span>
                <button
                  className="group-add"
                  aria-label="Add a role or a person"
                  title="Add a role or a person"
                  onClick={() => setAdding((v) => !v)}
                >
                  <Icon name="plus" size={12} />
                </button>
              </div>

              {subjects.map((s) => {
                const { name, colour } = nameOf(s)
                const on = same(chosen, s)
                /* @everyone is the baseline every channel has rather than
                   something added to it, so there is nothing to take away —
                   it would be back on the next render. */
                const fixed = s.kind === 'role' && s.id === everyone?.id
                return (
                  <div className={on ? 'perm-subject-row on' : 'perm-subject-row'} key={key(s)}>
                    <button className="perm-subject" onClick={() => setSubject(s)}>
                      <span className="dot" style={{ background: colour ?? 'var(--fnt)' }} />
                      <span className="perm-subject-n">{name}</span>
                      {rules && hasRules(rules.overrides, s.kind, s.id) && (
                        <span className="cnt2">set</span>
                      )}
                    </button>
                    {!fixed && (
                      <button
                        className="perm-subject-x"
                        aria-label={`Take ${name} off this channel`}
                        title={`Take ${name} off this channel`}
                        onClick={() => remove(s)}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </div>
                )
              })}

              {adding && (
                <div className="perm-add">
                  <p className="sect">Roles</p>
                  {freeRoles.length === 0 && <p className="hint">All of them are listed.</p>}
                  {freeRoles.map((r) => (
                    <button
                      key={r.id}
                      className="access-chip"
                      onClick={() => {
                        setPending((p) => [...p, { kind: 'role', id: r.id }])
                        setSubject({ kind: 'role', id: r.id })
                        setAdding(false)
                      }}
                    >
                      <span className="dot" style={{ background: roleColour(r) ?? 'var(--fnt)' }} />
                      {r.name}
                    </button>
                  ))}
                  <p className="sect">People</p>
                  {freePeople.length === 0 && <p className="hint">Nobody else to add.</p>}
                  {freePeople.map((m) => (
                    <button
                      key={m.id}
                      className="access-chip"
                      onClick={() => {
                        setPending((p) => [...p, { kind: 'member', id: m.id }])
                        setSubject({ kind: 'member', id: m.id })
                        setAdding(false)
                      }}
                    >
                      {nameIn(world, space.id, m)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="chlist perm-rows">
              {!rules && <p className="hint">Reading…</p>}

              {rules && asked.map((id) => {
                const now = verdictOf(verdicts, id)
                return (
                  <div className="row" key={id}>
                    <span className="txt">
                      <span className="t">{named(id).label}</span>
                      <span className="d">{named(id).detail}</span>
                    </span>
                    {/* Three buttons rather than one that rounds: all three
                        states are visible, and any of them is one press away.
                        Cycling makes going back a lap of the other two, and
                        hides which state a rule is even in until it is read. */}
                    <span className="tri">
                      {(['refuse', 'inherit', 'allow'] as const).map((v) => (
                        <button
                          key={v}
                          className={now === v ? `on ${CLASS[v]}` : CLASS[v]}
                          title={`${named(id).label} — ${WORD[v]}`}
                          aria-label={`${named(id).label}: ${WORD[v]}`}
                          aria-pressed={now === v}
                          onClick={() => {
                            if (now === v) return
                            const next = new Map(verdicts)
                            if (v === 'inherit') next.delete(id)
                            else next.set(id, v)
                            write(next)
                          }}
                        >
                          <Icon name={ICON[v]} size={13} />
                        </button>
                      ))}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* A warning rather than a refusal. Refusing yourself something in
              a channel is a reasonable thing to do deliberately and a
              miserable thing to do by accident, and the server allows it — so
              this says so while it can still be undone. */}
          {chosen?.kind === 'member' && chosen.id === world.me.id && (
            <p className="hint note">This is you. Anything refused here applies to you too.</p>
          )}
          {said && <p className="hint">{said}</p>}
        </div>

        <div className="mft">
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </Over>
  )
}

/** What each of the three states is called, where somebody can read it. */
const WORD: Record<Verdict, string> = {
  allow: 'allowed here',
  refuse: 'refused here',
  inherit: 'whatever the server says',
}

/* Refusing is the loud one and allowing the quiet one, which is the right way
   round: a channel that takes something away is the thing worth spotting in a
   list of twenty rows. */
const CLASS: Record<Verdict, string> = { allow: 'yes', refuse: 'no', inherit: 'neutral' }
const ICON: Record<Verdict, IconName> = { allow: 'check', refuse: 'x', inherit: 'dots' }
