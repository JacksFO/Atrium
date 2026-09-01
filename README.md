# Atrium

A chat app. Text, voice and screen sharing.

Anyone can make an account. You arrive with nothing — no friends and no
servers — and go from there: add people, make a server of your own, or join
somebody else's with an invite. A server belongs to whoever created it, and
nobody outside it has any say in what happens inside it.

It began as one server that a handful of friends were invited into, and the
shape of that is still visible in places. What is true now is the paragraph
above: Atrium is one app that people sign up to, and running it is not a
rank inside it.

This file is for whoever is working on Atrium or standing an instance of it
up, so it talks about hardware, environment variables and operator tooling.
None of that is part of the app people use, and none of it should ever
appear in something a person signing up can read.

Runs as one Node process against one SQLite file. No Docker, no Postgres, no
search service, no object storage bill.

## What it is

| | |
|---|---|
| Server | Fastify + a WebSocket gateway |
| Database | SQLite in WAL mode, FTS5 for search |
| Client | React + Vite + TypeScript |
| Voice | LiveKit, proxied through the same port as everything else |
| Screen sharing | WebRTC, peer to peer, with a TURN relay for the pairs that need one |
| Desktop | Electron, with push-to-talk that works while another window has focus |

## What is in here

Four packages under `apps/`, and it is worth knowing which is which before
reading any of it.

| | |
|---|---|
| `apps/server` | The whole back end: routes, the WebSocket gateway, the database, permissions. One Node process. |
| `apps/web` | **The client.** React + TypeScript. This is what you get in a browser and what the desktop app loads. |
| `apps/desktop` | The Electron shell around it - tray, push-to-talk, screen picker, auto-update, rich presence. |
| `apps/client` | The client that came *before* the React one. Not what anybody uses. |

`apps/client` is still here for one reason: it is the page the desktop app
falls back to when it cannot reach a server - a first run with no address, or
a server that is down. The React client resolves the API against the address
it was served from, which works everywhere except there, because that page is
opened from disk over `app://` and was not served from anywhere. Giving
`apps/web` a baked-in address is the work that would let `apps/client` be
deleted, and until that is done the old one is the only thing that can greet
somebody whose server is not answering.

Screens go straight between the two people rather than through the server. The
trade is honest and worth stating: whoever is sharing uploads one copy per
viewer, so sharing to four people costs them four uploads. What changes is that
it is no longer always the server's bandwidth, no matter who is sharing — which
matters when the server is somebody's desktop on a home connection.

## Running it

Needs Node 22 or newer and `pnpm`.

```bash
pnpm install

cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# paste that into AUTH_SECRET in .env

pnpm dev
```

Nobody claims anything. The first account is just the first account — there
is no owner, no claim code, and no kind of account that means anything
outside a server somebody made.

Whether anybody can sign up is `OPEN_REGISTRATION` in `.env`. With it off,
people need an invite:

```bash
pnpm --filter @atrium/server invite        # 1 use, expires in 7 days
pnpm --filter @atrium/server invite 5 30   # 5 uses, expires in 30 days
```

Members can create invites too, unless whoever runs the server turns that
off in its **Settings → Invites** — a decision inside that server, made by
the person who made it.

Two routes are about the hardware rather than about anybody's server —
`/api/admin/health` and `/api/admin/storage`. They are proved with
`OPERATOR_TOKEN` from `.env`, sent as the `x-operator-token` header, and
answer 404 without it. No account can reach them, signed in or not.

## Letting people in

Two ways, depending on how much you want to expose.

**Over the internet.** Point a domain at the server — DuckDNS is free and
supported directly — set `ACME_DOMAIN` and a DNS provider token in `.env`, and
the server gets a real Let's Encrypt certificate and renews it itself. The
certificate is proved over DNS, so port 80 never has to be open. Run on 443 and
nobody has to type a port number.

Ports that need forwarding:

| Port | Why |
|---|---|
| 443/tcp | Everything: the app, the API, the gateway, voice signalling |
| 7881/tcp | Voice media, for networks that block UDP |
| 7882/udp | Voice media, the normal path |

Voice media cannot travel over the websocket, which is why it needs its own
ports. Screen sharing needs none — it is peer to peer, and uses TURN when a
direct route cannot be found.

**Over a private network instead.** Put the machine and everyone's PCs on a
ZeroTier network and hand out the ZeroTier address. Nothing is exposed to the
internet at all, which makes a category of attack impossible rather than merely
unlikely. The trade is that everybody installs ZeroTier.

## TURN, for screen shares that will not connect

Most pairs connect directly. Some — strict NAT, mobile networks, some office
connections — cannot, and need a relay. Cloudflare's is free for far more than a
handful of people:

1. **dash.cloudflare.com → Realtime → TURN Server → Create**
2. Put the Turn Token ID and API Token into `CLOUDFLARE_TURN_KEY_ID` and
   `CLOUDFLARE_TURN_API_TOKEN`

Without it, a share between two people who cannot reach each other directly will
sit connecting and never arrive. With it, **Hide my IP** also becomes available:
screen shares connect directly by default, so the people watching can read your
address out of their browser, and that setting routes yours through the relay
instead. Slightly slower, and it only hides yours — everybody decides for
themselves.

## Backups

`scripts/backup.mjs` snapshots the database, archives the uploads, encrypts both
with AES-256-GCM and keeps the last thirty. It also removes log files older
than three weeks, which nothing used to do. Set `BACKUP_PASSPHRASE` before it
runs for the first time, or it writes them in the clear.

It will not prune anything - snapshots or logs - on a night when the snapshot
it just took did not verify. Deleting the oldest good backup to make room for
one that has been shown not to open is the exact way a backup system destroys
what it exists to protect.

Set the four `R2_*` variables and it also uploads to Cloudflare R2, pruned to the
same retention. A backup on the same disk as the thing it protects is not a
backup: one failure takes the data and every copy of it. R2's free tier is ten
gigabytes and costs nothing to read back, which is the moment that matters.

**Keep the passphrase somewhere other than the machine.** If the disk dies and
the only copy was in `.env` on it, every backup you own is undecryptable rubbish
— which is precisely the situation backups exist for.

### Getting one back

```
node scripts/recover.mjs                    what is in the bucket
node scripts/recover.mjs latest ./recovered fetch and decrypt the newest set
```

That fetches from R2 and decrypts in one step, leaving a `.db` you can open and
a `.zip` holding the uploads folder. It writes only where you tell it and never
near the live data.

### Prove it works, before you need it

A backup nobody has restored is a folder of files you hope are useful. Do this
occasionally — it takes ten minutes and touches nothing:

1. `node scripts/recover.mjs latest ./recovered`
2. Unzip the uploads beside the database.
3. Start a server against them on a spare port, with its own `AUTH_SECRET`:
   `DATA_DIR=... UPLOAD_DIR=... PORT=8824 TLS=false npx tsx src/index.ts`
4. Sign in and look. Messages, avatars, attachments.

Things this catches that counting rows does not: a passphrase that changed, an
archive that unzips empty, attachments whose bytes went somewhere else, and a
snapshot older than a migration. The last one is the normal case rather than a
fault — the server adds missing columns on boot — but "the current code can
still open a database from before its last three columns existed" is only worth
knowing if somebody has checked.

`scripts/install-tasks.cmd`, run as administrator, installs four scheduled
tasks: start the server at logon, start LiveKit at logon, check every five
minutes that both are still listening, and back up nightly at 04:00. All four
run through a shim that creates them with no console window, because a task
that opens a window every five minutes gets switched off by whoever is gaming
on that machine.

Run it **elevated**. The two logon tasks fail with "Access is denied" from an
ordinary shell while the other two are created quite happily, so a normal run
looks half successful and the two that actually start things are the two that
did not install.

## What works

- Accounts, invite-only sign-up, sessions that survive a reload, password changes
  that end every other session
- Channels, DMs and group conversations, ordered by when they were last used
- Live messages with optimistic send, reconnect with jittered backoff, and a
  queue that flushes when the connection returns
- Channels only some people can see, by role or by member
- Roles and permissions, with the rank rule that stops a moderator moderating
  somebody above them
- Voice, with per-member volume, local mute, server mute and deafen, push to talk
- Moving people between voice channels and disconnecting them, on its own
  permission rather than borrowing one
- Screen sharing to as many people as want to watch, each choosing whether to
  watch and at what volume, with a stream you can keep in the corner while you
  read something else
- Quality, and which window you are showing, both changeable mid-share without
  anybody having to reconnect - and the share follows you between voice
  channels rather than making you set it up again
- A list of who is watching your screen, right now
- `@` mentions for people and roles, `:shortcode` emoji, reactions, replies,
  editing, pinning, full-text search
- Uploads streamed to disk, images shown inline, GIFs that stop when you look away
- Names you can colour, letter and decorate, the same everywhere they appear
- Notifications with quiet hours, per-channel muting, and an unread state the
  server remembers

## How it holds things

Worth knowing before reading the schema, because two of these were arrived at
the hard way.

**Everything you can be inside is a container.** A server and a conversation
are different things to a person and the same thing to a permission check:
somewhere with people in it. So there is one `containers` table and one
`container_members` table, and "what may this person see" is one question with
one answer instead of two joined by hand. This replaced `space_members` and
`dm_members`, which had to be asked separately and could disagree.

**A room belongs to a server; a conversation belongs to its members.** That is
a rule the database keeps, not a habit the code has: `channels` carries a
CHECK saying a row has a server if and only if it is not a conversation. Before
that it was an assumption written in comments, and where the assumption was
wrong the code fell back to "the first server" - which answered confidently
about somebody else's.

**A server is a `space` in the schema and a "server" everywhere a person can
see.** Not laziness: "Server" was already taken by the machine this runs on,
and renaming the column would have meant one word meaning two things in the
same file. Discord has the same split - a guild in the API, a server in the
app.

## Notes to whoever works on this next

**SQLite is the right call and will stay that way.** At seven people in WAL mode
it is not remotely stressed. If it ever needs Postgres, the queries are plain SQL
in `apps/server/src/` and the port is mechanical.

**Hooks must never be written inside JSX.** A `useMemo` in one branch of a
ternary stops being called when the other branch renders, React sees fewer hooks
than last time, and the entire app stops. That happened here — joining a voice
channel took the app down — so `hooks.test.ts` now walks every component and
fails on a hook inside JSX or behind a condition.

**Do not put `backdrop-filter` on message rows.** It is on about eight large
panels and that is deliberate: it costs GPU per blurred surface. The
`Reduced transparency` setting turns it off wholesale.

**Layout gotcha that will bite again:** the app shell needs both
`grid-template-rows: minmax(0, 1fr)` and `min-height: 0` on the columns. Without
them the message list grows the column instead of scrolling, and the composer is
pushed off the bottom of the window.

**A grid with a fixed row template will not tolerate a conditional child.** The
connection banner appeared and disappeared and shunted every row along with it.
Anything that comes and goes needs its own permanent slot.

**Uploads are streamed to disk, never buffered.** Keep it that way.

**A track arrives with no MediaStream, and that is normal.** The sharer adds
its tracks with `addTransceiver`, which signals no stream at all, so `ontrack`
fires with an empty `streams` array. Reading `ev.streams[0]` and returning when
it is missing threw the picture away at the moment it arrived - the connection
reached `connected`, and nothing was ever seen. Build the stream from
`ev.track` instead.

**Do not ask for H.264 by default.** `getCapabilities` lists it as sendable on
machines that cannot encode a single frame of it, and the result is a
connection that reports itself connected and sends nothing - which looks
exactly like a broken network. Hardware encoding is opt in, and puts itself
back if no frames follow.

**Migrations must not swallow errors.** Each one used to be a `try/catch`
assuming the only possible failure was the column already existing — so a real
failure was invisible and the first symptom was a query for a column that was
never added. `addColumn()` ignores a duplicate and stops the boot on anything
else.

## Security

- Passwords hashed with scrypt and a per-user salt, compared in constant time
- Sessions are signed JWTs pinned to HS256, carrying the point at which that
  account's sessions were last ended — so changing a password ends every other
  one rather than merely looking like it
- Sign-in returns an identical error for a wrong username and a wrong password,
  so it cannot be used to find out who has an account
- Every route is authenticated except sign-up and sign-in; rate limits on both,
  per IP and per account
- No cookies anywhere, so a foreign site cannot make an authenticated request at
  all
- Uploads restricted by MIME allowlist. **SVG is deliberately excluded** — it is
  an image that can carry script, and would be a stored XSS. Filenames are
  replaced with a UUID, so nothing can climb out of the folder
- Message bodies are rendered as React elements, never HTML. There is no
  `dangerouslySetInnerHTML` anywhere and there must never be
- The link preview and image proxy resolve every redirect hop themselves and
  refuse private addresses, so neither can be pointed at the machine's own network
- `.env`, `data/`, `uploads/` and `backups/` are gitignored. Do not commit them

Run `pnpm test` before pushing. Most of those tests exist because something
they cover was once broken.

There is a second suite for the things a unit test structurally cannot see:

```
pnpm test:ui              every spec
pnpm test:ui phone        only the ones whose name matches
```

It builds the client, starts a server on a database of its own for each
spec, and drives the real app in a real window — measuring boxes, asking
`elementFromPoint` what a finger would actually hit, and sending real touch
events. Every spec in `test/ui/specs` is a bug somebody hit while using the
app: a button that took its whole row and squeezed its own label to nothing,
a menu that shut in the click meant to open a box inside it, a member list
with no way to reach it below 1180px. All of them rendered without error and
all of them were unusable.

Two things it will never do, both learned the hard way: it never builds into
`apps/web/dist`, which is the folder the live server hands to everyone, and it
never stops a server by process name — the live one is an ordinary
`node.exe`, so `taskkill /IM node.exe` takes the whole thing offline. Servers
are found by port and stopped by pid.


## Licence

Atrium is proprietary, and all rights are reserved. It is not open source.
See [LICENSE](LICENSE) for the whole of it.

The instructions above are here because the author runs this, and because
whoever works on it next needs them. They are notes for running it, not
permission to run it — being able to read a repository has never been the
same thing as being allowed to use what is in it, and nothing here grants
that. If you want to do something the licence does not allow, ask:
jacksfo97@gmail.com.

The open-source components this is built on — React, Fastify, Electron,
LiveKit and the rest — remain under their own licences, held by their own
authors. None of the above applies to them.
