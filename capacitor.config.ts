import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.noth2.mangamanager',
  appName: 'Halftone',
  webDir: 'dist',
  android: {
    // Reader pages and thumbnails are served from https://localhost/_mm/… by
    // the native interceptor; no mixed content is needed.
    allowMixedContent: false
  }
}

export default config
