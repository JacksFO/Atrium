import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /*
     * Runs before anything a test imports, which is the only moment that
     * works: config reads DATA_DIR when it is first imported, and by the time
     * a test body runs, db.js is already open on whatever it found. See
     * src/testenv.ts for what went wrong without this.
     */
    setupFiles: ['./src/testenv.ts'],
  },
})
