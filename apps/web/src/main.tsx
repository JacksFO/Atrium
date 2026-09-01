import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { carryOverPreferences } from './lib/renamed'
import './app.css'

/**
 * The way in.
 *
 * StrictMode on purpose, and it is worth saying why: in development it runs
 * effects twice to find the ones that are not safe to run twice. This app is
 * full of things that were exactly that in the old client — a socket opened
 * in a place that could run again, a timer that was never cleared, an
 * observer left watching an element that had gone. Those bugs showed up as
 * "it flickers" and "it opened twice", and each took a person noticing.
 * Better to have them shouted about here.
 */
/* Before anything reads a preference, and only ever once: what the browser
   remembers was stored under the app's old name. */
carryOverPreferences()

const host = document.getElementById('app')
if (!host) throw new Error('no #app to mount into')

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
