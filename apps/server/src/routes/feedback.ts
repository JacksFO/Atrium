import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { db } from '../db.js'
import type { User } from '../db.js'

type Authed = (req: unknown) => Promise<User | null>

/**
 * What people report from the button in the corner.
 *
 * Two things happen, in this order and never the other way round: the report
 * is written down here, and then somebody is told about it. Filing an issue
 * can fail - no token configured, no network, the far end down - and a report
 * that only ever existed as an HTTP request nobody answered is a report that
 * never happened. Anything that goes wrong after the row is written is a
 * delivery problem, and the report is still on the disk to deliver later.
 */

/** As long as a report may be. Short on purpose - see the note on the form. */
export const REPORT_MAX = 200

/** What somebody chose to call it. Not what it turns out to be. */
const KINDS = ['feedback', 'bug'] as const
export type ReportKind = (typeof KINDS)[number]

export function isKind(v: unknown): v is ReportKind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v)
}

/**
 * The one line an issue is titled with.
 *
 * Taken from the report rather than asked for separately: at two hundred
 * characters a title and a body would be one field split in half, and the
 * first thing somebody types is already the summary.
 */
export function titleOf(text: string): string {
  const first = text.trim().split('\n')[0]?.trim() ?? ''
  const line = first || text.trim()
  return line.length > 72 ? `${line.slice(0, 71)}…` : line
}

/** Only what helps to reproduce it. Never what anybody was saying. */
function contextOf(body: Record<string, unknown>): string {
  const pick = ['version', 'platform', 'build', 'desktop'] as const
  const out: Record<string, string> = {}
  for (const k of pick) {
    const v = body[k]
    if (typeof v === 'string' && v) out[k] = v.slice(0, 60)
    if (typeof v === 'boolean') out[k] = String(v)
  }
  return JSON.stringify(out)
}

export function registerFeedbackRoutes(
  app: FastifyInstance,
  authed: Authed,
  allow: (key: string, times: number, withinMs: number) => boolean,
): void {
  app.post('/api/feedback', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    /* A handful an hour. Enough for somebody hitting a run of problems,
       few enough that the button cannot become a way to fill the disk. */
    if (!allow(`feedback:${user.id}`, 10, 60 * 60_000)) {
      return reply.code(429).send({ error: 'that is a lot of reports - try again shortly' })
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const kind = body.kind
    if (!isKind(kind)) return reply.code(400).send({ error: 'say whether it is feedback or a bug' })

    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) return reply.code(400).send({ error: 'say what you would like to report' })
    if (text.length > REPORT_MAX) {
      return reply.code(400).send({ error: `keep it under ${REPORT_MAX} characters` })
    }

    const id = randomUUID()
    db.prepare(
      `INSERT INTO feedback (id, user_id, kind, title, body, context, issue, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(id, user.id, kind, titleOf(text), text, contextOf(body), Date.now())

    /* Told about, not waited on. Whether an issue was opened is not something
       the person reporting can do anything about, and a form that spins while
       GitHub is slow is a form people press twice. */
    void fileIssue(id, kind, text, user.username, contextOf(body))
      .catch(() => { /* the row is written; delivery can be retried */ })

    return { ok: true }
  })
}

/**
 * Open an issue for it, where that is set up.
 *
 * Off unless FEEDBACK_REPO names one. Reports are written down regardless, so
 * the tracker is somewhere to work through them rather than the only copy -
 * and pointing this at a public repository would publish what people write,
 * so it is something to turn on deliberately rather than a default.
 */
async function fileIssue(
  id: string, kind: ReportKind, text: string, from: string, context: string,
): Promise<void> {
  const repo = config.feedbackRepo
  const token = config.feedbackToken
  if (!repo || !token) return

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'Atrium',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title: titleOf(text),
      body: `${text}\n\n---\nFrom **${from}** in the app.\n\n\`\`\`json\n${context}\n\`\`\``,
      labels: [kind === 'bug' ? 'bug' : 'feedback'],
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return
  const made = (await res.json()) as { number?: number }
  if (typeof made.number === 'number') {
    db.prepare('UPDATE feedback SET issue = ? WHERE id = ?').run(made.number, id)
  }
}
