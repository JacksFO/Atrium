import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Where the tests are allowed to write.
 *
 * DATA_DIR is resolved from the server's own source location rather than the
 * working directory - which is deliberate, so the running server finds the
 * database wherever it was started from. The cost is that a test importing
 * db.js opens the LIVE database, and one that writes a row writes it into
 * the real one. That is exactly what happened: a test that needed a user to
 * sign out inserted one, and the live server had thirteen accounts where it
 * should have had twelve.
 *
 * Nothing warned. The test passed, the suite was green, and the only sign was
 * a stray username noticed while auditing something else.
 *
 * So every test run gets a directory of its own, made before anything can
 * import config, and thrown away afterwards. Set here rather than in each
 * test, because the next test to need a row will not remember to do it.
 */
const scratch = mkdtempSync(join(tmpdir(), 'atrium-test-'))

process.env.DATA_DIR = scratch
process.env.UPLOAD_DIR = join(scratch, 'uploads')
/* Long enough to satisfy the real check, and obviously not a real one. */
process.env.AUTH_SECRET ??= 'test-secret-not-for-anything-real-0123456789'

/* Nothing in a test should reach the outside world either. */
delete process.env.ACME_DOMAIN
delete process.env.ACME_EMAIL

process.on('exit', () => {
  try { rmSync(scratch, { recursive: true, force: true }) } catch { /* going away anyway */ }
})
