/**
 * Read what people have reported.
 *
 *   pnpm --filter @atrium/server feedback           everything not dealt with
 *   pnpm --filter @atrium/server feedback all       including what is done
 *   pnpm --filter @atrium/server feedback done <n>  mark one as dealt with
 *
 * A script rather than a screen, on purpose. Reports are about the app and
 * sometimes about the people in it, so there is no route that hands them back
 * out - nothing in the client can ask for them, whoever is signed in. The
 * only way to read them is to be at the machine the server runs on.
 */

import { db } from '../db.js'

type Row = {
  id: string
  kind: string
  title: string
  body: string
  context: string
  issue: number | null
  created_at: number
  done_at: number | null
  username: string | null
}

/* Added here rather than in the schema: it is a fact about working through
   them, not about the report, and nothing but this script has an opinion. */
try {
  db.exec('ALTER TABLE feedback ADD COLUMN done_at INTEGER')
} catch {
  /* already there */
}

const [what, which] = process.argv.slice(2)

if (what === 'done') {
  const n = Number(which)
  const rows = db.prepare(
    'SELECT id FROM feedback WHERE done_at IS NULL ORDER BY created_at DESC',
  ).all() as unknown as Array<{ id: string }>
  const row = rows[n - 1]
  if (!row) {
    console.log(`There is no open report ${which}.`)
    process.exit(1)
  }
  db.prepare('UPDATE feedback SET done_at = ? WHERE id = ?').run(Date.now(), row.id)
  console.log(`Report ${n} marked as dealt with.`)
  process.exit(0)
}

const all = what === 'all'
const rows = db.prepare(`
  SELECT f.id, f.kind, f.title, f.body, f.context, f.issue, f.created_at, f.done_at,
         u.username
    FROM feedback f
    LEFT JOIN users u ON u.id = f.user_id
   ${all ? '' : 'WHERE f.done_at IS NULL'}
   ORDER BY f.created_at DESC
`).all() as unknown as Row[]

if (rows.length === 0) {
  console.log(all ? 'Nothing has been reported yet.' : 'Nothing waiting.')
  process.exit(0)
}

const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')

console.log('')
rows.forEach((r, i) => {
  const tag = r.kind === 'bug' ? 'BUG ' : 'IDEA'
  const done = r.done_at ? ' (dealt with)' : ''
  const issue = r.issue ? `  issue #${r.issue}` : ''
  console.log(`${String(i + 1).padStart(3)}. [${tag}] ${when(r.created_at)}  ${r.username ?? 'somebody'}${issue}${done}`)
  for (const line of r.body.split('\n')) console.log(`     ${line}`)
  if (r.context && r.context !== '{}') console.log(`     ${r.context}`)
  console.log('')
})
console.log(
  `${rows.length} report${rows.length === 1 ? '' : 's'}` +
  (all ? '' : ' waiting. `feedback all` shows the rest, `feedback done <n>` clears one.'),
)
