import React from 'react'
import { createRoot } from 'react-dom/client'
import { installBackend } from '../../backend'
import App from './App'
import './pressGuard'
import './styles.css'
import './mobile.css'

// A (no-op) touchstart listener makes the WebView apply :active the moment a
// finger lands, so the press feedback appears without delay.
document.addEventListener('touchstart', () => {}, { passive: true })

// window.api is implemented in-process (src/backend) — boot it before the UI.
installBackend()
  .catch((e) => {
    console.error('[backend]', e)
    document.body.textContent = '초기화 실패: ' + String(e?.message ?? e)
    throw e
  })
  .then(() =>
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  )
