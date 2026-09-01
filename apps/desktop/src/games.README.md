# `games.json`

A map of Windows executable name to game name, used to recognise a game that
is running so presence can say "Playing Escape from Tarkov".

## What it is

10,107 entries, one line, executable name in lower case to the name of the
game. Nothing else: no ids, no art, no urls.

## Where it came from

Derived once, by hand, from the publicly served list of detectable games that
Discord publishes. **The app never contacts Discord.** This is a static file
compiled into the desktop build; there is no API call, no key, no dependency,
and nothing at runtime that knows Discord exists. Recorded here because a
public repository should say where its data came from rather than leave it to
be guessed at.

## What was deliberately removed

267 entries were dropped, and the removal matters more than the list:

- **Runtime hosts** — `java.exe`, `python.exe`, `node.exe`, `electron.exe`,
  `unity.exe` and the rest. The raw list maps `java.exe` to a game called
  Illarion, so anybody running any Java program at all would have been
  announced to ten people as playing it.
- **Generic names** — `game.exe`, `launcher.exe`, `client.exe`, `main.exe`,
  `start.exe`. What an engine calls its output before anybody renames it, and
  shared by hundreds of unrelated programs. `launcher.exe` mapped to Total War.
- **Ordinary programs that happen to share a name** — `sh.exe` is the one
  that proved this rule was needed. Git for Windows ships it, so the first
  run against a real machine reported that its owner was playing SUPERHOT,
  from a shell this very list was being built in. The blocklist covers shells,
  build tools, browsers, editors and the common Windows services.
- **Twelve malformed keys** carrying a leading marker (`>hl2.exe`), which
  could never have matched a process name and were dead weight.

A wrong answer here is worse than no answer: presence that occasionally lies
about what somebody is doing is not a feature with a bug, it is a reason not
to turn the feature on. Short names are kept rather than dropped wholesale -
`hl2.exe`, `aces.exe` and `cs2.exe` are all real games - so the rule has to be
a list of things that are not games, not a rule about length.

## Regenerating

Deliberately not scripted. It is a static list that ages slowly, and anything
that fetched it on a schedule would be the link to somebody else's service
that this file exists to avoid. If it needs refreshing, do it by hand and keep
the exclusion rules above.
