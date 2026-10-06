// Backend-wide state (mobile counterpart of the desktop main/context.ts): the
// persisted store, app directories, and the event bus that replaces
// main → renderer IPC pushes.
import { Store } from './lib/store'

export const store = new Store()

// Filled by install() from the native plugin.
export const paths = {
  data: '', // app-private files dir (settings, library json, thumbs)
  cache: '',
  external: '', // shared storage root (/storage/emulated/0)
  download: '' // shared Download folder
}

type Listener = (payload: unknown) => void
const listeners = new Map<string, Set<Listener>>()

// Subscribe to a backend event channel; returns the unsubscribe function.
export function on<T>(channel: string, cb: (payload: T) => void): () => void {
  let set = listeners.get(channel)
  if (!set) listeners.set(channel, (set = new Set()))
  set.add(cb as Listener)
  return () => set!.delete(cb as Listener)
}

// Push an event to the UI (same name as the desktop helper so ported code reads alike).
export function sendToRenderer(channel: string, payload?: unknown): void {
  for (const cb of listeners.get(channel) ?? []) {
    try {
      cb(payload)
    } catch (e) {
      console.error('[event]', channel, e)
    }
  }
}

export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
