import { useEffect } from 'react'

export default function PwaRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // The app remains fully functional when service workers are unavailable.
      })
    }
  }, [])

  return null
}
