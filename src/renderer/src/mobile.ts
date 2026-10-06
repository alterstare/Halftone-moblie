// Phone-form-factor helpers. The UI is the desktop one; these switches adapt it
// to a touch screen (no hover) and a narrow viewport.

// Touch-only device (no mouse hover): hover previews / tooltips stay off.
export const isTouch = (): boolean => window.matchMedia('(hover: none)').matches

// Narrow viewport (phone portrait): side panes become overlays. Keep in sync
// with the max-width of the media query in mobile.css.
export const isNarrow = (): boolean => window.matchMedia('(max-width: 760px)').matches
