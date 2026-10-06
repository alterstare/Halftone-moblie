import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { AtRule, Node, Plugin } from 'postcss'

// Touch screens keep :hover on whatever was tapped last, so a tapped button
// stayed tinted / mid-animation after the finger lifted. Move every :hover
// selector into @media (hover: hover) — it then only applies with a real
// pointer (mouse, trackpad). Selectors without :hover in the same rule stay put.
const hoverOnlyWithPointer: Plugin = {
  postcssPlugin: 'hover-only-with-pointer',
  Once(root, { AtRule }) {
    root.walkRules((rule) => {
      if (!rule.selector.includes(':hover')) return
      for (let p = rule.parent as Node | undefined; p; p = p.parent as Node | undefined) {
        if (p.type === 'atrule' && /hover/.test((p as AtRule).params)) return // already gated
      }
      const hover = rule.selectors.filter((s) => s.includes(':hover'))
      const rest = rule.selectors.filter((s) => !s.includes(':hover'))
      const media = new AtRule({ name: 'media', params: '(hover: hover)' })
      media.append(rule.clone({ selectors: hover }))
      rule.after(media)
      if (rest.length) rule.selectors = rest
      else rule.remove()
    })
  }
}

// Web bundle loaded by the Capacitor Android shell (webDir = dist).
export default defineConfig({
  root: 'src/renderer',
  base: './',
  // doujin-tokens.json (search autocomplete snapshot) ships as a static asset.
  publicDir: resolve(__dirname, 'resources'),
  resolve: {
    alias: { '@': resolve(__dirname, 'src/renderer/src') }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022'
  },
  css: {
    postcss: { plugins: [hoverOnlyWithPointer] }
  },
  plugins: [react()]
})
