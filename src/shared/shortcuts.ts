// Hardware keys the reader understands (Bluetooth keyboards / page-turner
// remotes): page forward / back. A combo is "Ctrl+Shift+T"-style — modifiers in
// the fixed order Ctrl, Alt, Shift, then one key; letters/digits use the
// physical key (KeyboardEvent.code) so the Korean IME doesn't break them.
// `settings.shortcuts` (id → combos) can still override the defaults.

export type ShortcutId = 'nextPage' | 'prevPage'

const DEFAULTS: Record<ShortcutId, string[]> = {
  nextPage: ['ArrowRight', 'PageDown'],
  prevPage: ['ArrowLeft', 'PageUp']
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'HangulMode', 'Process'])

// Key part of a combo from an event: physical letter/digit (IME-proof), else
// the named key ("ArrowLeft", "F5", "Tab", "PageDown" …). null = modifier only.
function keyName(e: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  const m = /^(?:Key([A-Z])|Digit([0-9])|Numpad([0-9]))$/.exec(e.code)
  if (m) return m[1] ?? m[2] ?? m[3]
  if (e.key === ' ') return 'Space'
  return e.key.length === 1 ? e.key.toUpperCase() : e.key
}

// "Ctrl+Shift+T" for a key event (Cmd counts as Ctrl), or null for a lone modifier.
export function comboFromEvent(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>
): string | null {
  const k = keyName(e)
  if (!k) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(k)
  return parts.join('+')
}

// Effective combos of a key action: the user's override, else the defaults.
export function shortcutCombos(overrides: Partial<Record<string, string[]>> | undefined, id: ShortcutId): string[] {
  return overrides?.[id] ?? DEFAULTS[id]
}
