import '@fontsource/open-sans/400.css'
import '@fontsource/open-sans/600.css'
import '@fontsource/open-sans/700.css'
import '@fontsource/metropolis/600.css'
import './styles/app.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { leaveCall } from './calls/call'
import { applyTheme } from './lib/themes'
import { usePrefs } from './store/prefs'
import { bootstrap } from './sync/engine'
import { startPresence } from './sync/presence'
import { App } from './App'

applyTheme(usePrefs.getState().theme)
void bootstrap()
startPresence()
// Leave the call properly when the app quits
window.hubbub.calls.onHangup(() => void leaveCall().finally(() => window.hubbub.calls.setActive(false)))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
