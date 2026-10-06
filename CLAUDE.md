# MangaManagerMobile — handoff for a new session

Read this first. It is written for a Claude session that has NOT seen the
desktop project's history (memory is per working folder, so nothing carries
over automatically).

## 1. What this is

**Goal:** a mobile version of **MangaManager**, the user's desktop manga
library manager. The desktop app is the reference implementation:

- Desktop source: `C:\Users\noth2\Desktop\code\manga-viewer-2`
  (GitHub `alterstare/Manga_Manager`, latest release **v0.5.4**).
- Its architecture/conventions doc: `manga-viewer-2\DEV_NOTES.md` — up to date
  as of 2026-10-02. Read it before porting anything.

**App name (2026-10-06): Halftone** (launcher label / strings.xml / capacitor appName; package id and the `Download/MangaManager` folder unchanged).

**Decided (2026-10-02):** Android only (sideload APK, no store), Capacitor,
translation removed, main purpose = online reading + downloads (hitomi + toki).
Repo stays `alterstare/Manga_Manager-moblie-`; code was rebuilt from desktop
v0.4.1, then (2026-10-05) brought to **desktop v0.5.4 parity**: renderer +
shared replaced with v0.5.4 (translation removed again — translate/ocr/
inpaint/export, TransEditor/TransWork/WorkTransEditor/CharacterMemo,
TranslateSection, transProjects/transMemos settings), backend got the 0.5.x
main changes (ratings files, editions finder, group rename, read progress,
random/excluded browse, toki status/stall/ad-filter), app version 0.5.4.
Electron is gone. When the desktop moves on, diff `vA..vB` in manga-viewer-2
and port the same way (renderer copied, main changes hand-ported to src/backend).

## 2. Architecture (this folder)

- `src/renderer/` — the desktop React UI, nearly unchanged. Talks only to
  `window.api` (type `Api` in `src/shared/ipc.ts`). Phone tweaks:
  `mobile.ts` (isTouch/isNarrow), `mobile.css` (≤760px overrides), reader list
  pane = overlay drawer, hover preview/tooltips off on touch, Android back →
  `navBack`, at root toggles the exit modal (App.tsx).
  Library cards are phone-specific (diverge from desktop — re-apply when
  porting a newer desktop renderer). 목록형 (list) = the wide tile: cover left
  (112×160, vertically centered) / text right (full title, artist 1 line +
  `MoreClamp`, tags ≤5 rows `TagList lines fluid`), bar = stars | 더보기 |
  즐겨찾기·다운로드(그룹) (`TileBar more`), 더보기 opens `CardMore` under the
  card (다른 언어 작품 찾기 button → `EditionsPanel`, 3×3 page preview paged by
  swipe; on a phone `EditionsPanel` shows each hit as cover (tap = read) +
  `CompactBar` 즐겨찾기 | 다운로드 only). 격자형 (grid) = 2-column compact `.ctile` (cover 3:4, title 2 lines,
  [code] · artist, `CompactBar` 즐겨찾기 | 다운로드(그룹), no rating) in
  `.compact-grid`. Same components, `compact` prop: WorkGridCard,
  SeriesGridCard, OnlineFavCard (layout), Browse inline. (WorkCard/SeriesCard
  list rows are unused on the phone.) Folder / 메타 채우기 / 삭제 live in the
  long-press menu (useWorkCard / useSeriesCard). TokiBrowse has no layout
  toggle (wide tiles, no 더보기); its 인증창 / 주소 / 비상용 fold out from a
  chevron at the chips row's end, genres from a centered 장르 더보기. `ConfirmModal` portals to body (`compact` =
  text-only dialog).
  Thumbnails (phone): every cover box uses `--thumb-ratio` (338/480, a typical
  cover, gallery 4224126) and the image fills the box WIDTH (taller → cropped
  top/bottom, wider → letterboxed top/bottom) — end of mobile.css.
  Settings rows with several buttons use `SettingRow stack`.
  관리 (phone): no ← 홈, tabs = `.chips` divider row, actions / card actions =
  `flat-group` text buttons, groups split by lines, cards 2 per row. 작업 목록
  (Download.tsx) = the list only (manual 동인지 다운로드 pane removed), head
  icon buttons 전체 정지 · 전체 시작 · 완료 지우기, rows split by lines.
  Tab bar = `MobileTabBar.tsx` (desktop `TabBar.tsx` is unused, kept for
  porting reference): ☰ · 라이브러리 · 온라인, a one-tab-at-a-time swipe strip
  (scroll-snap, swiping never switches tabs), Chrome-style tab-count button →
  2-column tab grid (`tabSwitcherOpen`). Mode switch / 작업 목록 / 설정 are in
  the ☰ menu only. 기록 (menu, view `history`) = Home in history mode: local
  works by `lastViewedAt` + online works from `onlineHistory` (backend
  `history.json`, recorded in store.openOnline/openToki), newest first.
  Reader (phone): title/bottom bars overlay the pages (`.overlay-bars`), hide
  on a drag / tap-flip, a tap on the top / bottom 15% or the center 15% column toggles them; no artist in the title bar
  (online = globe icon; local works get a favorite heart instead of 폴더 열기); bottom bar = slider + ⋮, which (or a swipe up) expands
  mode · fit · 넘김 (paged: `pagedFlipSide`, scroll: `scrollTapFlip` 하단/OFF).
  Pinch zoom = visual only (`vz` ref in Reader): `.zoom-layer` (scroll: the page
  column; paged/spread: a wrapper) is CSS-scaled from 0,0 and the pane's scroll
  pans it, anchored under the fingers; below fit rubber-bands then springs back
  to 1. Layout `zoom` (fit button / Ctrl+wheel) is separate; scroll-mode page
  math divides scrollTop by `vz.s`. Double tap (taps wait 260ms for a second
  one) toggles fit ⇄ fill (`toggleZoomAt`, same vz). Page slider = custom
  track (`.page-slider-wrap`): online pages already decoded (ratioRef) show as
  light-purple bands (`--page-loaded`), progress purple, native range = thumb.
  Reader list drawer: toggle rides the drawer edge (`--pane-w`), `.list-scrim`
  closes it on any touch outside; sidebar search has no 🔍 button, sort icon
  dropdown inside (library + online lists); sidebar cards (`.lib-tile`) = grid
  tile build (centered cover + `TileBar`). Search boxes are pill-shaped
  (concentric with the round icon buttons). Page zoom is off (viewport
  user-scalable=no, `touch-action: pan-x pan-y`, WebView setSupportZoom(false)).
  Long-press menus (`ContextMenu`) on touch = centered popup over a dimmed
  backdrop; an outside touch closes it on touch END with a fade (the backdrop
  must outlive the tap's click, or the click hits what's underneath).
  Reader: swipe flips in paged/spread (direction from `pagedFlipSide`), title
  long-press = 제목 / 작품 번호 복사, page long-press = 이미지 저장
  (`saveImageToDownloads` → MMPlugin, MediaStore Downloads). TileBar empty
  space falls through to the card's click.
  Library screens (Home incl. 기록, Browse, TokiBrowse) use
  `components/libraryTools.tsx`: `usePullRefresh` (children slide by --ptr,
  spinner above the search box; Home = page 1 + `scanLibraryJob`, online = page
  1 + reloadKey fetch), `LibraryFab` (portaled round +, hides on scroll down,
  drop-up 새로고침 / 작품 선택), `useSelection` + `SelectBar` (fixed to the bottom edge, portaled; 전체
  선택 · 해제 | 삭제(local) / 다운로드(online, sequential) | ×) — cards carry
  `data-sel` + checkbox via `useSel`/`SelBox`; Android back ends selection
  (`popBack`).
  Opening the reader / 관리 / 작업 목록 replays the mode-switch blur (App.tsx,
  `.mode-switching`).
  Tab strip: new tabs animate in (held 'pre-enter' two frames so the reader's
  mount frame doesn't eat it); tab grid has open/close animations.
  `pressGuard.ts`: a press on a control inside a card (tag, +N, star, button)
  marks the card `no-press` so only the control shows press feedback.
  Every CSS `:hover` rule is moved into `@media (hover: hover)` at build time
  (PostCSS plugin in vite.config.ts) — no stuck hover tint after a tap.
- `src/backend/` — the desktop main process ported to run IN the WebView and
  implement `window.api` (`index.ts` installBackend, `api/*.ts` = old
  `ipc/*.ts`, `lib/*.ts` = old `lib/*.ts`). Node APIs are shimmed:
  `node/fs.ts`, `node/path.ts`, `node/bytes.ts` → native plugin. Events
  (`sendToRenderer`) are an in-process bus (`context.ts`).
- `android/app/src/main/java/com/noth2/mangamanager/` — native side:
  - `MMPlugin.java` (`MM`): fs, httpGet/httpDownload, DoH, pickers (SAF
    folder → real path, file open/save), storage permission (MANAGE_EXTERNAL_STORAGE),
    toki WebView control, toast/exit.
  - `Net.java`: OkHttp. kind `hitomi` = DoH (1.1.1.1 by IP) + UA/Referer;
    `toki` = WebView cookies + UA + site Referer; disk image cache (400MB).
  - `MMWebViewClient.java`: serves `https://localhost/_mm/{img|web|toki}/<b64url>`
    (local file / hitomi image / toki image) — replaces desktop `mangaimg://`.
  - `Tunnel.java`: SNI-bypass local CONNECT proxy (desktop green-tunnel
    equivalent: DoH + ClientHello split into 40-byte TLS records). On when
    `settings.bypassTunnel`; toki OkHttp client + every WebView (ProxyController)
    go through it.
  - `TokiWeb.java`: hidden scraper WebView kept BEHIND the app WebView;
    brought to front for Cloudflare / manual browsing (title bar + 닫기).
    Doc-start script hides webdriver + stubs WebRTC. JS drives it via
    tokiLoad/tokiState/tokiEval (`backend/lib/toki.ts`).
- Data: app-private files dir (settings/works/online json, thumbs). First run
  sets download dirs to `Download/MangaManager/{hitomi,manga}`.

Known gaps / TODO: downloads run in WebView JS (stall when app backgrounded —
needs a foreground service); UI still desktop-shaped in places (home/browse
toolbars, tab bar, settings); no update check; app icon = `app.png` (repo root) rendered into the mipmap
folders (adaptive foreground full-bleed, white background, + legacy square/round);
toki online not tested against the live site (needs the user's address).

## Build / test

Toolchain (installed 2026-10-02, user-local): JDK 21 `~/.jdks/jdk-21.0.12.1+1`,
Android SDK `%LOCALAPPDATA%\Android\Sdk` (platform 36, build-tools, emulator,
AVD `mm_test` = Pixel 7 / API 35), jadx `~/.jdks/jadx`.

```
npm run typecheck
npm run sync                      # vite build + cap sync android
cd android && JAVA_HOME=<jdk> ./gradlew.bat assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```
Emulator debugging: `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`
then CDP `Runtime.evaluate` (e.g. call `window.api.*`). Git Bash mangles
`/storage/...` adb paths — set `MSYS_NO_PATHCONV=1`.

Reference apps for Android behavior: `C:\Users\noth2\Desktop\code\mangaview\`
— `MangaViewAndroid-2112240502.zip` (source of a manatoki viewer: WebView
captcha → cookies → OkHttp) and `Pupil-v5.3.23.apk` (hitomi client; decompile
with jadx; same gg.js logic as desktop `hitomi.ts`).

## 3. Domain knowledge to carry over (from the desktop app)

Two library modes:

- **hitomi** — doujinshi galleries identified by a numeric gallery code.
  Online: index/search via nozomi files + gallery JS; image URLs come from
  hitomi's `gg.js` (desktop `src/main/lib/hitomi.ts`, ported from node-hitomi).
  The domain is DNS-blocked in Korea → the desktop resolves hosts via DoH
  (Cloudflare 1.1.1.1 by IP) and connects to the IP directly. Requests need a
  hitomi Referer. The site address is user-entered (`hitomiBaseUrl`).
- **normal (general manga / webtoon)** — a "toki"-family site (React SPA,
  e.g. sbxh9.com, domain changes often; user-entered `tokiBaseUrl`). Behind a
  Cloudflare-style check the user clears once in a visible browser window;
  the desktop scrapes it with a hidden Chromium window (`src/main/lib/toki.ts`).
  List state is in the URL: `/manhwa|/ing ?g=<genre>&sort=<fresh|hot|views|rating|episodes>&page=N`,
  search `/search?q=&field=title|author&match=contains|exact&page=N`, chapter
  list paged by `?epage=N`, viewer images = `img.viewer-lazy-img[data-src]`.
  Some ISPs reset TLS by SNI for the site domain; its DNS CNAME (a BunnyCDN
  host like `sbxh9f.b-cdn.net`) serves the same site unblocked. (Desktop 0.4.1
  tried switching to it automatically; reverted in 0.4.2 — not used now.)
- A "backup" gnuboard-style site can be scraped by hand (user navigates, app
  reads the chapter list) — desktop `TokiBackupModal`.

Favorites model (desktop, 2026-10): one heart per gallery — the favorites list
keyed by hitomi code; local copies mirror it; general-manga series favorites
are linked to online ones by normalized title. Favorites file = Pupil-compatible
JSON `{favorites:[ids], favorite_tags:[{area,tag}], ranks:{code:n}}` — the
natural format for desktop ⇄ mobile sync.

## 4. Working with this user

- Korean, terse ("caveman") replies. UI strings are Korean.
- **Commits only when asked**; messages are subject-only, **no
  `Co-Authored-By` / Claude trailers** (the user removed them from history).
  Git identity: `alterstare <alterstare03@gmail.com>`.
- Release flow (desktop): bump version → commit → push → tag `vX.Y.Z` → CI
  builds a draft release → the user publishes on GitHub.
- Never add a default/bundled site address; the user enters URLs themselves
  (a hard-coded backup-site URL was scrubbed from desktop history).
- The user tests on their own device; verify what you can yourself and say
  plainly what you could not verify.
- **UI design rule:** buttons, control groups and panel sections get NO
  outline/box — neighbors are separated by divider lines only (vertical between
  inline buttons, horizontal between stacked sections). Close = borderless X
  icon (`.icon-close` + `CloseIcon`), never a "닫기" text button.
