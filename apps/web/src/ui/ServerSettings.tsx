import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Still } from './Still'
import { loadRoles } from '../lib/load'
import { actorOf, saidOf, type AuditEntry } from '../lib/audit'
import { grantableRoles, mayActOn, rankOf, type Member } from '../lib/members'
import { may, PERMISSION_GROUPS, permissionMeta, type PermissionId } from '../lib/permissions'
import { nameIn } from '../lib/names'
import { inRankOrder, roleColour } from '../lib/roles'
import type { Api } from '../lib/api'
import type { Id, Role, Space } from '../lib/wire'
import type { World } from '../lib/world'
import { Avatar } from './Avatar'
import {
  shrinkForUpload, AVATAR_EDGE, BANNER_EDGE, PROFILE_SMALL_ENOUGH,
} from '../lib/shrinkimage'
import { Icon, type IconName } from './Icon'
import { useDragOrder } from './useDragOrder'
import { Aside, AsideCard } from './SettingsWindow'

/**
 * A server's own settings.
 *
 * Every pane here is gated on a permission, and a gated pane is *absent*
 * rather than shown and refused — which is why the list of them is built from
 * what this account may do rather than filtered afterwards. It also means the
 * same bug always looks the same from outside: somebody says a feature was
 * never built, and it was, and they cannot reach it.
 */

export type ServerPaneId =
  | 'overview' | 'channels' | 'roles' | 'invites' | 'members' | 'bans' | 'audit'

/**
 * The panes, and what each one needs to be allowed to open it.
 *
 * A gated pane is *absent* rather than shown and refused, which is why the
 * list is built from what this account may do rather than drawn and then
 * filtered. It also means the same bug always looks the same from outside:
 * somebody says a feature was never built, and it was, and they cannot
 * reach it.
 */
export const SERVER_PANES: ReadonlyArray<
  readonly [ServerPaneId, string, PermissionId | readonly PermissionId[], IconName]
> = [
  ['overview', 'Overview', 'manage_space', 'gear'],
  ['channels', 'Channels', 'manage_channels', 'hash'],
  ['roles', 'Roles', 'manage_roles', 'shield'],
  /*
   * Any one of the things this pane is for, not just handing out roles.
   *
   * It was manage_roles alone, and every control for acting on a person
   * lives inside it - so somebody trusted to remove people, or to bar them,
   * or to rename them, and nothing else, could not reach a single one of
   * them. Adding the ban button made that plain rather than causing it: that
   * account got a Bans pane it could lift bans from and no way anywhere to
   * make one.
   *
   * Which is the failure this list's own comment describes - a feature that
   * was built, and cannot be reached, and gets reported as never built.
   */
  ['members', 'Members', ['manage_roles', 'kick_members', 'ban_members', 'manage_nicknames'], 'people'],
  ['invites', 'Invites', 'create_invite', 'key'],
  /* Its own pane rather than a filter on Members, because the people on it
     are by definition not members - there is no row in the member list to
     hang them off, and a ban that cannot be found again cannot be lifted. */
  ['bans', 'Bans', 'ban_members', 'ban'],
  ['audit', 'Audit log', 'view_audit_log', 'layers'],
]

/** The ones this account may actually open, in order. */
export function serverPanesFor(permissions: readonly string[]) {
  return SERVER_PANES.filter(([, , perm]) =>
    (Array.isArray(perm) ? perm : [perm as PermissionId]).some((p) => may(permissions, p)))
}

/**
 * One of a server's settings panes.
 *
 * The window this used to carry its own copy of is gone: your settings and a
 * server's are one window now, because "which of the two windows was that in"
 * is the same problem as "which pane was that in", only worse. What is left
 * here is the panes themselves.
 */
export function ServerPane({ id, server, world, space, permissions, onChanged, onClose }: {
  id: ServerPaneId
  server: Api
  world: World
  space: Space
  permissions: readonly string[]
  /** Something changed that the rest of the app reads. */
  onChanged: () => void
  /** Only for deleting the server, which leaves nothing to look at. */
  onClose: () => void
}) {
  const title = SERVER_PANES.find(([p]) => p === id)?.[1] ?? ''

  return (
    <>
      {/*
        * The pane says what it is, the way every other pane in this window
        * does. In its own window it did not need to - the nav was the only
        * other thing on screen. Sharing a window with panes that each carry
        * a heading, half of them announcing themselves and half not is the
        * kind of difference that reads as one of them being unfinished.
        *
        * The cards below used to repeat it, so those headings are gone
        * rather than said twice.
        */}
      <h2 className="stitle">{title}</h2>
      {id === 'overview' && (
        <>
          <Overview server={server} space={space} onChanged={onChanged} />
          {/* Only whoever made it. Not manage_space, which somebody can be
              given to help run a server and is not the same as being handed
              the ability to end it. */}
          {space.owner_id === world.me.id && (
            <DeleteServer server={server} space={space} onGone={onClose} />
          )}
        </>
      )}
      {id === 'roles' && (
        <Roles server={server} world={world} space={space}
          permissions={permissions} onChanged={onChanged} />
      )}
      {id === 'channels' && (
        <Channels server={server} world={world} space={space} onChanged={onChanged} />
      )}
      {id === 'members' && (
        <Members server={server} world={world} space={space}
          permissions={permissions} onChanged={onChanged} />
      )}
      {id === 'invites' && (
        <Invites server={server} space={space} invitesAt={world.invitesAt}
          me={world.me.id} mayRevokeAny={may(permissions, 'manage_space')} />
      )}
      {id === 'bans' && <Bans server={server} space={space} />}
      {id === 'audit' && <Audit server={server} space={space} />}
    </>
  )
}

/* ------------------------------------------------------------- overview -- */

function Overview({ server, space, onChanged }: {
  server: Api
  space: Space
  onChanged: () => void
}) {
  const ids = useId()
  const [name, setName] = useState(space.name)
  const [descr, setDescr] = useState(space.description ?? '')
  const [said, setSaid] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  /* Its own, because one hidden file box cannot know which of the two
     pictures it is being opened for. */
  const banner = useRef<HTMLInputElement>(null)

  return (
    <div className="card">
      <h4>What this server is called</h4>
      {/* The label is tied to the box rather than merely sitting above it.
          They read as a pair on screen and were nothing of the sort to a
          screen reader, which had an unnamed text box - and clicking the
          word did not put the cursor in it either. */}
      <div className="fld">
        <label htmlFor={`${ids}-name`}>Name</label>
        <input id={`${ids}-name`} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="fld">
        <label htmlFor={`${ids}-descr`}>Description</label>
        <input id={`${ids}-descr`} value={descr} placeholder="What goes on in here"
          onChange={(e) => setDescr(e.target.value)} />
      </div>
      <button className="btn p" onClick={() => {
        void server.patch(`/api/space?spaceId=${encodeURIComponent(space.id)}`,
          { name, description: descr })
          .then(() => { setSaid('Saved.'); onChanged() })
          .catch((e: unknown) => setSaid(e instanceof Error ? e.message : 'That would not save.'))
      }}>Save</button>

      <div className="row">
        <span className="txt">
          <span className="t">Icon</span>
          <span className="d">What this server looks like in the rail.</span>
        </span>
        {space.icon_path
          ? <Still className="sicon" path={space.icon_path} />
          : <span className="lab">{space.name.slice(0, 2).toUpperCase()}</span>}
        <button className="btn" onClick={() => picker.current?.click()}>Change</button>
        {space.icon_path && (
          <button className="btn d" onClick={() => {
            /* A server icon is cleared with a delete of its own; a person's
               picture is cleared with an empty patch. Two shapes for the same
               idea, and using either one for the other is a 404 or a no-op. */
            void server.delete(`/api/space/icon?spaceId=${encodeURIComponent(space.id)}`)
              .then(() => { setSaid('Cleared.'); onChanged() })
              .catch((e: unknown) =>
                setSaid(e instanceof Error ? e.message : 'That would not clear.'))
          }}>Clear</button>
        )}
      </div>

      {/*
        * And the strip across the top of the channel list.
        *
        * A separate picture from the icon on purpose: an icon is a small
        * square read at thirty pixels and a banner is a wide strip read at
        * three hundred. The strip used to stretch the icon, which looks
        * exactly like a small square blown up.
        */}
      <div className="row">
        <span className="txt">
          <span className="t">Banner</span>
          <span className="d">The strip above the channels. Wide suits it best.</span>
        </span>
        {space.banner_path
          ? <Still className="sbanner" path={space.banner_path} />
          : <span className="lab">Art from its name</span>}
        <button className="btn" onClick={() => banner.current?.click()}>Change</button>
        {space.banner_path && (
          <button className="btn d" onClick={() => {
            void server.delete(`/api/space/banner?spaceId=${encodeURIComponent(space.id)}`)
              .then(() => { setSaid('Cleared.'); onChanged() })
              .catch((e: unknown) =>
                setSaid(e instanceof Error ? e.message : 'That would not clear.'))
          }}>Clear</button>
        )}
      </div>

      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) {
            /* An icon is drawn as a small circle in the rail and nowhere
               larger, so it goes up at the size a picture of a person does.
               An animated one is left alone - see shrinkimage. */
            void shrinkForUpload(f, { edge: AVATAR_EDGE, smallEnough: PROFILE_SMALL_ENOUGH })
              .then((small) => server.raw(
                'POST',
                `/api/space/icon?spaceId=${encodeURIComponent(space.id)}`,
                small, small.type,
              ))
              .then(() => { setSaid('Saved.'); onChanged() })
              .catch((err: unknown) =>
                setSaid(err instanceof Error ? err.message : 'That would not upload.'))
          }
          e.target.value = ''
        }}
      />

      <input
        ref={banner}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) {
            /* A banner spans the top of the pane, so it keeps the wider
               edge - still a long way under what a camera produces. */
            void shrinkForUpload(f, { edge: BANNER_EDGE, smallEnough: PROFILE_SMALL_ENOUGH })
              .then((small) => server.raw(
                'POST',
                `/api/space/banner?spaceId=${encodeURIComponent(space.id)}`,
                small, small.type,
              ))
              .then(() => { setSaid('Saved.'); onChanged() })
              .catch((err: unknown) =>
                setSaid(err instanceof Error ? err.message : 'That would not upload.'))
          }
          e.target.value = ''
        }}
      />

      {said && <p className="hint">{said}</p>}
    </div>
  )
}

/* ---------------------------------------------------------------- roles -- */

function Roles({ server, world, space, permissions, onChanged }: {
  server: Api
  world: World
  space: Space
  permissions: readonly string[]
  onChanged: () => void
}) {
  const here = inRankOrder(world.roles.filter((r) => r.space_id === space.id))
  const [openId, setOpenId] = useState<Id | null>(here[0]?.id ?? null)
  const role = here.find((r) => r.id === openId) ?? null
  const [said, setSaid] = useState('')

  /*
   * The whole list, in the order it is drawn.
   *
   * Both ends already agree that first means highest: byRank sorts on
   * `b.position - a.position`, and the route writes `length - i`, so the
   * first id it is handed gets the top position. Reversing it here — which
   * was the first guess — turns the ranking upside down every time anybody
   * nudges one, and looks exactly like the buttons doing the opposite of
   * what they say.
   */
  const order = useDragOrder(
    here.map((r) => r.id),
    (ids) => {
      void server.post('/api/roles/reorder', { order: ids, spaceId: space.id })
        .then(refresh)
        .catch((e: unknown) => setSaid(e instanceof Error ? e.message : 'That would not save.'))
    },
    { keyboard: true, nameOf: (id) => here.find((r) => r.id === id)?.name ?? id },
  )

  const refresh = async () => {
    const got = await loadRoles(server, space.id)
    world.roles = [
      ...world.roles.filter((r) => r.space_id !== space.id),
      ...got.roles,
    ]
    world.assignments = [
      ...world.assignments.filter((a) => !got.roles.some((r) => r.id === a.role_id)),
      ...got.assignments,
    ]
    onChanged()
  }

  return (
    <>
      <div className="card">
        <div className="chlist">
          {here.map((r, i) => (
            <div className="chan drow" key={r.id}
              aria-label={`${r.name}, ${i + 1} of ${here.length}. Drag to move it, or press Space to pick it up.`}
              {...order.rowProps(r.id)}>
              <span className="grip"><Icon name="grip" size={13} /></span>
              <button
                className={r.id === openId ? 'nm on' : 'nm'}
                style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 1, minWidth: 0 }}
                onClick={() => { setOpenId(r.id); setSaid('') }}
              >
                <span className="dot" style={{ background: roleColour(r) ?? 'var(--fnt)' }} />
                {r.name}
              </button>
              {r.kind !== 'custom' && <span className="cnt2">{r.kind}</span>}
            </div>
          ))}
        </div>
        <p className="said" role="status" aria-live="polite">{order.said}</p>

        <button className="btn" onClick={() => {
          void server.post('/api/roles', { name: 'New role', colour: '#8395A6', spaceId: space.id })
            .then(refresh)
            .catch((e: unknown) => setSaid(e instanceof Error ? e.message : 'That would not save.'))
        }}>
          <Icon name="plus" size={14} /> New role
        </button>
      </div>

      {role && (
        <RoleEditor
          key={role.id}
          server={server}
          role={role}
          canGrant={permissions}
          /* Administrator is the owner's to give, and an administrator holds
             it - so holding it is not the question the switch can ask. */
          owns={space.owner_id === world.me.id}
          onSaved={refresh}
          onSaid={setSaid}
        />
      )}
      {said && <p className="hint">{said}</p>}
    </>
  )
}

function RoleEditor({ role, server, canGrant, owns, onSaved, onSaid }: {
  role: Role
  server: Api
  canGrant: readonly string[]
  /** Whether this is the person who made the server. */
  owns: boolean
  onSaved: () => void
  onSaid: (s: string) => void
}) {
  const [name, setName] = useState(role.name)
  const [colour, setColour] = useState(roleColour(role) ?? '#8395A6')
  const [hoist, setHoist] = useState(!!role.hoist)
  const [held, setHeld] = useState<Set<string>>(() => new Set(parse(role.permissions)))

  /* The owner role's permissions are the "everything" the ordering is built
     on, and its position is the ceiling every other role is measured against
     — so the server refuses to change either, and offering the switches would
     be offering a refusal. Its name and colour are presentation and are
     somebody's to change. */
  const looksOnly = role.kind === 'owner'
  const named = role.kind !== 'everyone'

  const ids = useId()

  const save = (body: Record<string, unknown>) => {
    void server.patch(`/api/roles/${encodeURIComponent(role.id)}`, body)
      .then(() => { onSaid('Saved.'); onSaved() })
      .catch((e: unknown) => onSaid(e instanceof Error ? e.message : 'That would not save.'))
  }

  /*
   * The same, for the colour, which is dragged rather than typed.
   *
   * A colour input fires while the pointer moves. Here that is worse than on
   * a profile: changing a role tells everybody in the server that roles have
   * changed, and each of them then asks for the whole list again - so one
   * drag is hundreds of writes and hundreds of refetches per member. The
   * swatch on screen follows the pointer either way.
   */
  const later = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsaved = useRef<Record<string, unknown> | null>(null)

  const saveSoon = (body: Record<string, unknown>) => {
    unsaved.current = body
    if (later.current) clearTimeout(later.current)
    later.current = setTimeout(() => {
      later.current = null
      const held = unsaved.current
      unsaved.current = null
      if (held) save(held)
    }, 400)
  }

  /* Leaving the panel mid-drag must not lose the colour just chosen. */
  useEffect(() => () => {
    if (!later.current) return
    clearTimeout(later.current)
    const held = unsaved.current
    unsaved.current = null
    if (held) void server.patch(`/api/roles/${encodeURIComponent(role.id)}`, held).catch(() => {})
  }, [server, role.id])

  return (
    <div className="card">
      <h4>{role.name}</h4>

      {named && (
        <div className="fld">
          <label htmlFor={`${ids}-rolename`}>Name</label>
          <input id={`${ids}-rolename`} value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== role.name && save({ name })} />
        </div>
      )}
      {!named && (
        <p className="hint">
          Everybody in the server holds this one, and it keeps its name. What
          it allows is very much yours to change — that is the whole point of
          it.
        </p>
      )}

      <div className="fld">
        <label htmlFor={`${ids}-colour`}>Colour</label>
        <input id={`${ids}-colour`} type="color" value={colour}
          onChange={(e) => { setColour(e.target.value); saveSoon({ colour: e.target.value }) }} />
      </div>

      <div className="row">
        <span className="txt">
          <span className="t">Show holders separately</span>
          <span className="d">
            Everybody with this role gets their own heading in the member list.
          </span>
        </span>
        <button
          className={hoist ? 'sw on' : 'sw'}
          role="switch"
          aria-checked={hoist}
          aria-label="Show holders separately"
          onClick={() => { setHoist(!hoist); save({ hoist: !hoist }) }}
        />
      </div>

      {looksOnly ? (
        <p className="hint">
          This role allows everything, and that is what the order of every
          other role is measured against. It cannot be changed.
        </p>
      ) : (
        <>
          {PERMISSION_GROUPS.map(([group, ids]) => (
            <div key={group}>
              <p className="sect">{group}</p>
              {ids.map((id) => {
                /* You cannot give away what you do not hold. The server
                   refuses it too — this only avoids offering a refusal, and
                   says why rather than showing a switch that does nothing. */
                /* Except Administrator, which is the owner's to give even
                   though an administrator holds it: one who can make more
                   of them can hand out the whole server without the person
                   who made it ever agreeing. */
                const ownerOnly = id === 'administrator'
                const mayGive = ownerOnly ? owns : may(canGrant, id)
                const on = held.has(id)
                return (
                  <div className="row" key={id}>
                    <span className="txt">
                      <span className="t">{permissionMeta(id).label}</span>
                      <span className="d">
                        {mayGive ? permissionMeta(id).detail
                          : id === 'administrator' ? 'Only the owner can give this one'
                            : 'You do not hold this yourself'}
                      </span>
                    </span>
                    <button
                      className={on ? 'sw on' : 'sw'}
                      role="switch"
                      aria-checked={on}
                      aria-label={permissionMeta(id).label}
                      disabled={!mayGive}
                      onClick={() => {
                        const next = new Set(held)
                        if (on) next.delete(id)
                        else next.add(id)
                        setHeld(next)
                        save({ permissions: [...next] })
                      }}
                    />
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

/** The permissions a role holds, which the server stores as JSON. */
function parse(json: string): string[] {
  try {
    const list: unknown = JSON.parse(json)
    return Array.isArray(list) ? list.map(String) : []
  } catch {
    /* A row nothing can read grants nothing, which is the safe direction. */
    return []
  }
}

/* ------------------------------------------------------------- channels -- */

function Channels({ server, world, space, onChanged }: {
  server: Api
  world: World
  space: Space
  onChanged: () => void
}) {
  const here = world.channels
    .filter((c) => c.space_id === space.id)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  const [name, setName] = useState('')
  /* Which one is being renamed, and what to. Renaming happens on the row
     rather than in a dialog about the row - the name is already there, and a
     dialog would only show it again somewhere else. */
  const [editing, setEditing] = useState<Id | null>(null)
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<'text' | 'voice'>('text')
  const [catName, setCatName] = useState('')
  const [said, setSaid] = useState('')

  const done = (p: Promise<unknown>) => {
    void p.then(() => { setSaid(''); onChanged() })
      .catch((e: unknown) => setSaid(e instanceof Error ? e.message : 'That would not save.'))
  }

  /*
   * The whole list goes, not a moved id and a destination.
   *
   * It is the only version that cannot drift out of step with what is on
   * screen: two people reordering at once each send the list they are looking
   * at, and the second one wins entirely rather than landing half inside the
   * first one's arrangement.
   */
  const order = useDragOrder(
    here.map((c) => c.id),
    (ids) => done(server.post('/api/channels/reorder', { order: ids, spaceId: space.id })),
    {
      /* The row here opens nothing, so Space and Enter are free to mean
         pick up and put down. In the sidebar they are not - there the row
         is the button that opens the channel. */
      keyboard: true,
      nameOf: (id) => here.find((c) => c.id === id)?.name ?? id,
    },
  )

  return (
    <div className="card">
      <div className="chlist">
        {here.map((c, i) => (
          <div className="chan drow" key={c.id}
            aria-label={`${c.name}, ${i + 1} of ${here.length}. Drag to move it, or press Space to pick it up.`}
            {...order.rowProps(c.id)}>
            <span className="grip"><Icon name="grip" size={13} /></span>
            <Icon name={c.kind === 'voice' ? 'vol' : 'hash'} size={14} />
            {editing === c.id ? (
              <input
                className="rn"
                value={draft}
                autoFocus
                draggable={false}
                aria-label={`Rename ${c.name}`}
                /* The row is draggable, so a press meant for this box would
                   otherwise pick the whole channel up instead. */
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => setEditing(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setEditing(null); return }
                  if (e.key !== 'Enter') return
                  const want = draft.trim()
                  setEditing(null)
                  if (!want || want === c.name) return
                  done(server.patch(`/api/channels/${encodeURIComponent(c.id)}`, { name: want }))
                }}
              />
            ) : (
              <span className="nm">{c.name}</span>
            )}
            <button className="icb" title={`Rename ${c.name}`}
              aria-label={`Rename ${c.name}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => { setDraft(c.name); setEditing(c.id) }}>
              <Icon name="pencil" size={13} />
            </button>
            <button className="icb" title={`Delete ${c.name}`}
              aria-label={`Delete ${c.name}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => done(
                server.delete(`/api/channels/${encodeURIComponent(c.id)}`))}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
      </div>
      <p className="said" role="status" aria-live="polite">{order.said}</p>

      {/* The list you are arranging, drawn the way the sidebar draws it.
          Reading the same rows, so it cannot fall out of step: it is the
          arrangement, not a picture of one taken earlier. */}
      <Aside>
        <AsideCard title="In the sidebar">
          <div className="minisi">
            <b>{space.name}</b>
            {here.map((c) => (
              <span key={c.id}>
                <Icon name={c.kind === 'voice' ? 'vol' : 'hash'} size={12} />
                {c.name}
              </span>
            ))}
          </div>
        </AsideCard>
      </Aside>

      <div className="fld">
        <label>Add one</label>
        <input value={name} placeholder="general"
          onChange={(e) => setName(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={kind === 'text' ? 'btn p' : 'btn'}
          onClick={() => setKind('text')}>Text</button>
        <button className={kind === 'voice' ? 'btn p' : 'btn'}
          onClick={() => setKind('voice')}>Voice</button>
        <span className="gw" />
        <button className="btn p" disabled={!name.trim()} onClick={() => {
          void server.post('/api/channels', { name: name.trim(), kind, spaceId: space.id })
            .then(() => { setName(''); setSaid(''); onChanged() })
            .catch((e: unknown) =>
              setSaid(e instanceof Error ? e.message : 'That would not save.'))
        }}>Make it</button>
      </div>
      <p className="sect">Categories</p>
      <div className="chlist">
        {world.categories.filter((c) => c.space_id === space.id).map((c) => (
          <div className="chan" key={c.id}>
            <Icon name="folder" size={14} />
            <span className="nm">{c.name}</span>
            <button className="icb" title={`Delete ${c.name}`}
              aria-label={`Delete ${c.name}`}
              onClick={() => done(
                server.delete(`/api/categories/${encodeURIComponent(c.id)}`))}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="fld">
        <label>Add a category</label>
        <input value={catName} placeholder="Games"
          onChange={(e) => setCatName(e.target.value)} />
      </div>
      <button className="btn" disabled={!catName.trim()} onClick={() => {
        done(server.post('/api/categories', { name: catName.trim(), spaceId: space.id })
          .then(() => setCatName('')))
      }}>Make it</button>

      {said && <p className="hint">{said}</p>}
    </div>
  )
}

/* -------------------------------------------------------------- members -- */

function Members({ server, world, space, permissions, onChanged }: {
  server: Api
  world: World
  space: Space
  permissions: readonly string[]
  onChanged: () => void
}) {
  const [rows, setRows] = useState<Member[] | null>(null)
  const [said, setSaid] = useState('')
  const [openId, setOpenId] = useState<Id | null>(null)

  const load = useCallback(() => {
    setRows(null)
    void server.get<{ members?: Member[] }>(
      `/api/members/roles?spaceId=${encodeURIComponent(space.id)}`,
    )
      .then((r) => setRows(r.members ?? []))
      .catch((e: unknown) => {
        setRows([])
        setSaid(e instanceof Error ? e.message : 'Those would not load.')
      })
  }, [server, space.id])

  useEffect(load, [load])

  /*
   * Where the person doing the looking sits, which decides everything below.
   *
   * Read from the same roster rather than from the world's assignments: the
   * roster is what the server just said, and the two disagreeing is how a
   * button appears for something that is about to be refused.
   */
  const mineRow = rows?.find((m) => m.id === world.me.id)
  const myRank = rankOf(world.me.id, space, world.roles, mineRow?.roles ?? [])
  const canKick = may(permissions, 'kick_members')
  /* Its own permission, so a moderator trusted to break up an argument is
     not automatically trusted to decide who never comes back. */
  const canBan = may(permissions, 'ban_members')
  /* The server asks for manage_roles before it will grant anything to one
     person, so the control is absent without it rather than refused. */
  const mayGrant = may(permissions, 'manage_roles')

  /*
   * What each person's roles already give them.
   *
   * Worked out once for everybody rather than per row: it is the same
   * question asked of the same three lists, and a switch that says "a role
   * already gives them this" has to know before it can say it.
   */
  const byRole = new Map<Id, Set<PermissionId>>()
  for (const m of rows ?? []) {
    const held = new Set<PermissionId>()
    for (const r of world.roles) {
      if (r.space_id !== space.id) continue
      if (r.kind !== 'everyone' && !m.roles.includes(r.id)) continue
      for (const p of parse(r.permissions)) held.add(p as PermissionId)
    }
    byRole.set(m.id, held)
  }
  const grantable = grantableRoles(world.roles, space, myRank)

  const act = (done: Promise<unknown>) => {
    void done
      .then(() => { setSaid(''); load(); onChanged() })
      .catch((e: unknown) => setSaid(e instanceof Error ? e.message : 'That would not save.'))
  }

  return (
    <div className="card">
      {rows === null && <p className="hint">Reading…</p>}
      {rows?.length === 0 && !said && <p className="hint">Nobody is in here yet.</p>}

      <div className="chlist">
        {rows?.map((m) => {
          const theirRank = rankOf(m.id, space, world.roles, m.roles)
          const reachable = mayActOn(myRank, theirRank, m.id === world.me.id)
          return (
            <div key={m.id}>
              <button
                className={m.id === openId ? 'chan on' : 'chan'}
                onClick={() => setOpenId(m.id === openId ? null : m.id)}
              >
                <Avatar user={m} size="sm" />
                {/* What this server calls them, like the member list does -
                    a moderation pane that names people differently from the
                    column beside it is a pane about different people. */}
                <span className="nm">{nameIn(world, space.id, m)}</span>
                {m.id === space.owner_id && <span className="cnt2">owner</span>}
                {/* Findable from the list, or a permission handed out one
                    person at a time is invisible until somebody opens every
                    row looking for it. */}
                {(m.extras?.length ?? 0) > 0 && (
                  <span className="cnt2">{m.extras.length} extra</span>
                )}
                {/* Said out loud, because the alternative is a row whose
                    controls are simply absent for a reason nobody can see. */}
                {!reachable && m.id !== world.me.id && (
                  <span className="cnt2">above you</span>
                )}
              </button>

              {m.id === openId && (
                <div style={{ padding: '4px 10px 12px' }}>
                  {/*
                    * Handing out roles needs manage_roles, and the pane no
                    * longer does - somebody here to remove or bar people
                    * holds neither. Absent rather than shown and refused,
                    * which is the rule this whole file is built on, and it
                    * was only ever right by accident: the pane's own gate
                    * used to be the same permission.
                    */}
                  {mayGrant && grantable.length === 0 && (
                    <p className="hint">There are no roles you can hand out.</p>
                  )}
                  {(mayGrant ? grantable : []).map((r) => {
                    const has = m.roles.includes(r.id)
                    return (
                      <div className="row" key={r.id}>
                        <span className="txt">
                          <span className="t">{r.name}</span>
                        </span>
                        <button
                          className={has ? 'sw on' : 'sw'}
                          role="switch"
                          aria-checked={has}
                          aria-label={r.name}
                          disabled={!reachable}
                          onClick={() => act(server.post(
                            `/api/admin/members/${encodeURIComponent(m.id)}/roles`,
                            { roleId: r.id, grant: !has },
                          ))}
                        />
                      </div>
                    )
                  })}

                  {/*
                    * And anything given to them alone, on top of their roles.
                    *
                    * The route has been there since the table was added and
                    * nothing ever called it, so a permission could be granted
                    * to one person only by writing to the database. Roles are
                    * still the way to hand things out to a group; this is for
                    * the one person who needs one more thing than their role
                    * gives.
                    *
                    * Not for the owner, who has everything by definition, and
                    * not for somebody who outranks you.
                    */}
                  {mayGrant && reachable && m.id !== space.owner_id && (
                    <div className="perms">
                      <h4>Permissions</h4>
                      <p className="hint">
                        On top of their roles. What a role already gives is
                        shown and cannot be taken away here — change the role
                        for that.
                      </p>
                      {PERMISSION_GROUPS.map(([group, ids]) => (
                        <div key={group}>
                          <p className="sect">{group}</p>
                          {ids.map((id) => {
                            const meta = permissionMeta(id)
                            const fromRole = (byRole.get(m.id) ?? new Set()).has(id)
                            const extra = (m.extras ?? []).includes(id)
                            return (
                              <div className="row" key={id}>
                                <span className="txt">
                                  <span className="t">{meta.label}</span>
                                  <span className="d">
                                    {fromRole ? 'A role already gives them this' : meta.detail}
                                  </span>
                                </span>
                                <button
                                  className={fromRole || extra ? 'sw on' : 'sw'}
                                  disabled={fromRole}
                                  aria-label={meta.label}
                                  onClick={() => act(server.post(
                                    `/api/admin/members/${encodeURIComponent(m.id)}/permissions`,
                                    { spaceId: space.id, permission: id, grant: !extra },
                                  ))}
                                />
                              </div>
                            )
                          })}
                        </div>
                      ))}
                      {/* Said out loud, because it is the one that surprises
                          people: being allowed to kick does not mean being
                          allowed to kick anybody. */}
                      <p className="hint note">
                        Rank still applies on top of this: nobody can kick,
                        ban or rename somebody who holds a higher role than
                        their own, whatever is switched on here.
                      </p>
                    </div>
                  )}

                  {canKick && reachable && (
                    <button className="btn d" onClick={() => act(
                      server.delete(
                        `/api/admin/members/${encodeURIComponent(m.id)}?spaceId=${
                          encodeURIComponent(space.id)}`),
                    )}>
                      Remove from {space.name}
                    </button>
                  )}
                  {/*
                    * The two side by side, and said apart.
                    *
                    * Removing somebody and barring them are one click from
                    * each other and differ entirely in what they mean, so
                    * the difference is written under them rather than left
                    * to be discovered. A person who wanted the first and
                    * pressed the second has done something only somebody
                    * else can undo.
                    */}
                  {canBan && reachable && (
                    <button className="btn d" onClick={() => act(
                      server.post(
                        `/api/admin/members/${encodeURIComponent(m.id)}/ban?spaceId=${
                          encodeURIComponent(space.id)}`, {}),
                    )}>
                      Ban from {space.name}
                    </button>
                  )}
                  {canKick && canBan && reachable && (
                    <p className="hint">
                      Removing them lets them back in on the next invite.
                      Banning them does not, until somebody lifts it.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {said && <p className="hint">{said}</p>}
    </div>
  )
}

/* ----------------------------------------------------------------- bans -- */

/** One row of GET /api/admin/bans. */
type BanRow = {
  id: Id
  reason: string
  created_at: number
  /* Null when the account itself is gone. A ban outlives the account, and a
     row that cannot name anybody is still one somebody may want to lift. */
  username: string | null
  display_name: string | null
  avatar_path: string | null
  discriminator: string | null
}

/**
 * Who is barred from this server.
 *
 * The list exists because a ban has to be findable to be undone. Without it
 * the only record is the audit log, which says a ban happened and not
 * whether it is still in force - so lifting one would mean reading the
 * history and hoping nobody had lifted it already.
 */
function Bans({ server, space }: { server: Api; space: Space }) {
  const [rows, setRows] = useState<BanRow[] | null>(null)
  const [said, setSaid] = useState('')

  const load = useCallback(() => {
    void server.get<{ bans?: BanRow[] }>(
      `/api/admin/bans?spaceId=${encodeURIComponent(space.id)}`,
    )
      .then((r) => setRows(r.bans ?? []))
      .catch((e: unknown) => {
        setRows([])
        setSaid(e instanceof Error ? e.message : 'Those would not load.')
      })
  }, [server, space.id])

  useEffect(load, [load])

  const lift = (id: Id) => {
    void server.delete(
      `/api/admin/bans/${encodeURIComponent(id)}?spaceId=${encodeURIComponent(space.id)}`,
    )
      .then(() => { setSaid(''); load() })
      .catch((e: unknown) => setSaid(e instanceof Error ? e.message : 'That would not save.'))
  }

  return (
    <div className="card">
      <p className="hint">
        People who cannot join this server, however they are invited.
        Lifting a ban lets them back in — it does not put them back in.
      </p>

      {rows === null && <p className="hint">Reading…</p>}
      {rows?.length === 0 && !said && <p className="hint">Nobody is banned.</p>}

      {rows?.map((b) => (
        <div className="row" key={b.id}>
          <span className="txt">
            {/* The id when the account is gone, because it is the only thing
                left that identifies the row being lifted. */}
            <span className="t">{b.display_name || b.username || b.id}</span>
            <span className="d">
              {b.reason || 'No reason given'}
            </span>
          </span>
          <button className="btn" onClick={() => lift(b.id)}>Lift</button>
        </div>
      ))}

      {said && <p className="hint">{said}</p>}
    </div>
  )
}

/* ---------------------------------------------------------------- audit -- */

function Audit({ server, space }: { server: Api; space: Space }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null)
  const [said, setSaid] = useState('')

  useEffect(() => {
    let alive = true
    void server.get<{ entries?: AuditEntry[] }>(
      `/api/audit?spaceId=${encodeURIComponent(space.id)}`,
    )
      .then((r) => { if (alive) setRows(r.entries ?? []) })
      .catch((e: unknown) => {
        if (!alive) return
        setRows([])
        setSaid(e instanceof Error ? e.message : 'That would not load.')
      })
    return () => { alive = false }
  }, [server, space.id])

  return (
    <div className="card">
      {/* "What changed" read as release notes — which is what somebody looks
          for under that name, and what they now find under What's new in
          their own settings. This is who did what, which is a different
          question and deserves its own words. */}
      <p className="hint">
        The last hundred things anybody did to this server, and who did them.
        Kept whether or not that account is still here.
      </p>

      {rows === null && <p className="hint">Reading…</p>}
      {rows?.length === 0 && !said && <p className="hint">Nothing yet.</p>}

      {rows?.map((e) => (
        <div className="row" key={e.id}>
          <span className="txt">
            <span className="t">{actorOf(e)} {saidOf(e.action)}</span>
            {/* The detail is ids, which is what the server has to store and
                not something to read out — shown small and last, for the
                times somebody is trying to work out which one. */}
            {e.detail && <span className="d">{e.detail}</span>}
          </span>
          <span className="lab">{when(e.created_at)}</span>
        </div>
      ))}
      {said && <p className="hint">{said}</p>}
    </div>
  )
}

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

/* -------------------------------------------------------------- invites -- */

type Invite = {
  code: string
  uses_left: number
  expires_at: number | null
  created_at: number
  /** Null once whoever made it has been removed from the server. */
  created_by: string | null
}

/**
 * The codes into this server, and which of them are yours to take back.
 *
 * Making a key and taking back a key somebody else cut are not the same size
 * of act, and create_invite - which every member holds by default - used to
 * be enough for both. So the bin is drawn only where the server would accept
 * it: on your own, and on anybody's for somebody who may manage the server.
 *
 * Whose an invite is has to be said, or the difference reads as rows that
 * randomly cannot be deleted rather than as a rule.
 */
function Invites({ server, space, invitesAt, me, mayRevokeAny }: {
  server: Api
  space: Space
  /** Ticks when somebody makes or revokes one, so this asks again. */
  invitesAt: number
  /** Whose codes are yours. */
  me: Id
  /** Held by anybody who may see to the server, for the ones nobody owns. */
  mayRevokeAny: boolean
}) {
  const [list, setList] = useState<Invite[] | null>(null)
  const [said, setSaid] = useState('')

  const load = useCallback(() => {
    void server.get<{ invites?: Invite[] }>(
      `/api/invites?spaceId=${encodeURIComponent(space.id)}`,
    )
      .then((r) => setList(r.invites ?? []))
      .catch((e: unknown) => {
        setList([])
        setSaid(e instanceof Error ? e.message : 'Those would not load.')
      })
  }, [server, space.id])

  useEffect(load, [load])

  /*
   * And again when somebody else makes or revokes one.
   *
   * The list was fetched once when the pane opened and followed nothing after
   * that, so two people tidying invites saw two different lists - and a code
   * revoked by one of them still looked live to the other.
   */
  useEffect(load, [load, invitesAt])

  const done = (p: Promise<unknown>) => {
    void p.then(() => { setSaid(''); load() })
      .catch((e: unknown) => setSaid(e instanceof Error ? e.message : 'That would not go.'))
  }

  return (
    <div className="card">
      <p className="hint">
        A code lets somebody in. Anybody who has it can use it, so hand it out
        the way you would a key — and take it back the same way.
      </p>

      {list === null && <p className="hint">Reading…</p>}
      {list?.length === 0 && <p className="hint">None right now.</p>}

      <div className="chlist">
        {list?.map((i) => (
          <div className="chan" key={i.code}>
            <span className="nm" style={{ fontFamily: 'var(--fm)' }}>{i.code}</span>
            {/* What is left of it, which is the only thing anybody wants to
                know about a code they made last week. */}
            <span className="cnt2">
              {i.uses_left === 1 ? 'one use' : `${i.uses_left} uses`}
              {i.created_by === me && <span className="yours">yours</span>}
            </span>
            <button className="icb" title="Copy" aria-label={`Copy ${i.code}`}
              onClick={() => { void navigator.clipboard?.writeText(i.code) }}>
              <Icon name="copy" size={13} />
            </button>
            {/* Absent rather than refused: the server answers 403 for
                somebody else's, and a bin that always says no is worse than
                no bin. */}
            {(i.created_by === me || mayRevokeAny) && (
              <button className="icb" title="Revoke" aria-label={`Revoke ${i.code}`}
                onClick={() => done(
                  server.delete(`/api/invites/${encodeURIComponent(i.code)}`))}>
                <Icon name="trash" size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      <button className="btn p" onClick={() => done(
        server.post('/api/invites', { spaceId: space.id }))}>
        Make an invite
      </button>
      {said && <p className="hint">{said}</p>}
    </div>
  )
}

/**
 * Ending a server.
 *
 * The route has existed as long as servers have and nothing in this client
 * called it, so a server made by mistake stayed for ever.
 *
 * Typing the name is not ceremony. This deletes every channel, every message
 * and every role in it for everybody who was in it, and there is no undoing
 * it - so the confirmation is a thing that cannot be done by reflex, and the
 * name is what somebody has to look up at the top of the box and copy.
 */
function DeleteServer({ server, space, onGone }: {
  server: Api
  space: Space
  onGone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')

  /* Exactly, apart from the spaces either side - somebody who pasted it has
     not made a different decision from somebody who typed it. */
  const matches = typed.trim() === space.name.trim()

  const go = () => {
    if (!matches || busy) return
    setBusy(true)
    setSaid('')
    void server.delete(`/api/spaces/${encodeURIComponent(space.id)}`)
      .then(() => onGone())
      .catch((e: unknown) => {
        setSaid(e instanceof Error ? e.message : 'That would not delete.')
        setBusy(false)
      })
  }

  return (
    <div className="card danger">
      <h4>Delete this server</h4>
      <p className="hint">
        Every channel, message and role in it goes, for everybody who is in
        it. There is no undoing this.
      </p>

      {!open
        ? (
          <button className="btn bad" onClick={() => setOpen(true)}>
            Delete {space.name}
          </button>
        )
        : (
          <>
            <div className="fld">
              <label>Type <b>{space.name}</b> to confirm</label>
              <input value={typed} autoFocus
                placeholder={space.name}
                onKeyDown={(e) => { if (e.key === 'Enter') go() }}
                onChange={(e) => setTyped(e.target.value)} />
            </div>
            <div className="dangeracts">
              <button className="btn" onClick={() => { setOpen(false); setTyped('') }}>
                Keep it
              </button>
              <button className="btn bad" disabled={!matches || busy} onClick={go}>
                Delete for everybody
              </button>
            </div>
          </>
        )}

      {said && <p className="hint">{said}</p>}
    </div>
  )
}
