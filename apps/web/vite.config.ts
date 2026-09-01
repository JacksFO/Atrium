/* From vitest rather than vite: the same config, with the `test` block typed.
   Vite's own defineConfig does not know about it and refuses the file. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Say which build this is, in the two places that have to agree.
 *
 * The app tells somebody a newer build is being served by comparing the id
 * baked into the page against the one in /version.json. Neither existed:
 * index.html had no build meta at all, so the check gave up on its first line
 * and the banner could never appear however old the tab was; and version.json
 * was written only by deploy.mjs, so any deploy that copied the folder by
 * hand left yesterday's id sitting there.
 *
 * Both come from here now, from one value, at build time. They cannot drift
 * apart because there is nothing to keep in step - a build that writes one
 * writes the other.
 *
 * The id is the hash of the built asset names. Vite already names those by
 * their contents, so this changes exactly when something in the bundle
 * changed and not when a build simply ran again.
 */
function stampBuild(): Plugin {
  /*
   * Wherever this build is actually going.
   *
   * It was the literal 'dist'. A build sent anywhere else - `--outDir`, which
   * is how a copy is made without touching the one being served - then wrote
   * its stamp into a directory it had not built, and left the one it had
   * built with no stamp at all. A page with no stamp can never be told a
   * newer one exists, which is the exact fault this plugin was written to
   * fix, reintroduced by the way somebody built it.
   */
  let dir = 'dist'
  return {
    name: 'atrium-build-stamp',
    apply: 'build',
    configResolved(config) {
      dir = config.build.outDir
    },
    closeBundle() {
      const html = join(dir, 'index.html')
      let page: string
      try { page = readFileSync(html, 'utf8') } catch { return }

      /* The asset names as the page refers to them, in a fixed order so the
         id does not move because the page listed them differently. */
      const names = [...page.matchAll(/\/assets\/([\w.-]+)/g)]
        .map((m) => m[1] as string)
        .sort()
      const id = createHash('sha256').update(names.join('|')).digest('hex').slice(0, 12)

      writeFileSync(html, page.replace(
        '</head>',
        `  <meta name="build" content="${id}" />
  </head>`,
      ))
      writeFileSync(join(dir, 'version.json'), `${JSON.stringify({ build: id })}
`)
    },
  }
}

export default defineConfig({
  plugins: [react(), stampBuild()],
  build: {
    /* Vite's default baseline is very new. A phone a few years old then gets
       syntax it cannot parse, and because the entry is a module script the
       failure is silent: nothing runs, nothing throws, the page stays blank.
       These targets cover browsers back to roughly 2020 — the same ones the
       build this replaces was already reaching. */
    target: ['es2020', 'chrome87', 'edge88', 'firefox78', 'safari14'],
  },
  test: {
    /*
     * A browser, for the components that read one.
     *
     * Most of this suite renders to static markup, which needs nothing — but
     * a component that reads `window` while rendering cannot be rendered
     * outside a browser at all, so the app as a whole could not be drawn by a
     * test at all. Which is exactly the failure nothing else catches: a
     * component that throws on a shape it did not expect typechecks perfectly
     * and takes the whole screen with it at runtime.
     */
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  server: {
    port: 5274,
    host: true,
    proxy: {
      /*
       * `changeOrigin` off, deliberately.
       *
       * The voice token's address is built from the Host header — the server
       * hands back `wss://<whatever you used to reach me>/livekit` so that a
       * client on a phone is not sent to the machine's own localhost.
       * Rewritten to localhost:443 it points past this proxy at a port with a
       * self-signed certificate, and the browser refuses the socket without a
       * word anywhere. Left alone, the address comes back as this dev server
       * and the /livekit rule below carries it the rest of the way.
       */
      '/api': { target: 'https://localhost:443', secure: false },
      '/uploads': { target: 'https://localhost:443', secure: false },
      '/gateway': { target: 'wss://localhost:443', ws: true, secure: false },
      '/livekit': { target: 'wss://localhost:443', ws: true, secure: false },
    },
  },
})
