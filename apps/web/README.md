# The Atrium client, in React and TypeScript

The same app that is live now, converted. Not the old React build — that is
`apps/client`, and it is a different app with a different design. This is the
client from `lab/`, brought onto React, TypeScript and Vite, keeping the
layout and behaviour exactly as they are.

Nothing here is live. `lab/` still builds what gets deployed until this
reaches parity, and the swap is the same `deploy.mjs` with a different source.

## Why

Two reasons, both measured rather than assumed.

**Security.** The old client builds HTML by hand, so every value a person can
type has to be passed through `esc()` by somebody remembering to. The rule
meant to catch a miss was, it turned out, checking nothing at all — an
unescaped name put straight into a tag walked past it, and so did the simplest
case anybody could write. In React that class cannot happen: escaping is what
the renderer does, and the only way out is to type `dangerouslySetInnerHTML`.

**The shapes.** A day of bugs was almost entirely one thing: the client and
the server disagreeing about what a field was called or what it held, with
nothing to say so. `src/lib/wire.ts` writes down what the server actually
sends, and the three most expensive of those bugs are now compile errors:

```
e.presence on a presence event   → Property 'presence' does not exist
m.kind !== 'default'             → no overlap with MessageKind
{ path } on an outgoing file     → 'path' does not exist, it is 'url'
```

Those three are, in order: every status dot staying grey, every message in
every channel vanishing, and every image silently never sending.

## Order of work

1. **The foundation** — toolchain, wire types, and the pure logic that has no
   DOM in it. Done: swipe, presence.
2. **The rest of the logic** — activity lines, name styles, role order and
   colour, markdown, permissions. All testable without a browser.
3. **The data layer** — the adapter, ported with types on both ends. It stays
   for now; deleting it is its own job, and doing it at the same time as the
   UI is how rewrites die.
4. **The shell, then one pane at a time** — rail, channels, conversation,
   members, settings, the call stage.
5. **Parity, then the swap.**

## Running it

```
pnpm --filter @atrium/web dev        # port 5274, proxying to the live server
pnpm --filter @atrium/web test
pnpm --filter @atrium/web typecheck
pnpm --filter @atrium/web build
```
