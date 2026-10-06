// NAS (WebDAV / SMB) connections as seen by the UI. A NAS folder is a path
// "/nas/<connId>/<path>"; the native side resolves it. Passwords never reach
// here (see NasConn.hasPassword).
import { create } from 'zustand'
import type { NasConn } from '../../shared/ipc'

interface NasState {
  conns: NasConn[]
  loaded: boolean
  refresh: () => Promise<void>
}

export const useNas = create<NasState>((set) => ({
  conns: [],
  loaded: false,
  refresh: async () => set({ conns: await window.api.nasList(), loaded: true })
}))

export const isNasPath = (p: string | null | undefined): boolean => !!p && p.startsWith('/nas/')

// "/nas/<id>/a/b" → { id, rel: "a/b" }
export function splitNasPath(p: string): { id: string; rel: string } {
  const rest = p.slice('/nas/'.length)
  const i = rest.indexOf('/')
  return i < 0 ? { id: rest, rel: '' } : { id: rest.slice(0, i), rel: rest.slice(i + 1).replace(/\/+$/, '') }
}

// Readable form for the settings lists: "NAS이름:/a/b".
export function displayPath(p: string, conns: NasConn[]): string {
  if (!isNasPath(p)) return p
  const { id, rel } = splitNasPath(p)
  const c = conns.find((x) => x.id === id)
  return `${c ? c.name : '(삭제된 NAS)'}:/${rel}`
}

export const emptyConn = (type: NasConn['type']): NasConn => ({
  id: '',
  name: '',
  type,
  url: '',
  host: '',
  port: 0,
  share: '',
  domain: '',
  user: '',
  insecure: false
})
