// Phone-form-factor helpers. The UI is the desktop one; these switches adapt it
// to a touch screen (no hover) and a narrow viewport.

// Touch-only device (no mouse hover): hover previews / tooltips stay off.
export const isTouch = (): boolean => window.matchMedia('(hover: none)').matches

// Phone-width viewport (< 600px): the reader list is an overlay drawer. Wider
// (tablets) it's docked beside the pages. Keep in sync with the drawer media
// query at the top of mobile.css.
export const isNarrow = (): boolean => window.matchMedia('(max-width: 599px)').matches

// Reader list button: the user's choice, else by screen — phone = ☰ in the
// bottom bar, tablet = the floating edge toggle.
export const sidebarBtnMode = (s: { sidebarBtn?: 'bar' | 'float'; sidebarToggle?: 'bar' | 'float' }): 'bar' | 'float' =>
  s.sidebarBtn ?? (s.sidebarToggle === 'float' ? 'float' : isNarrow() ? 'bar' : 'float')
