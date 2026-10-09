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
translation removed, main purpose = online reading + downloads (doujin + comic).
Repo: **`alterstare/Halftone-moblie`** (git `origin`; the old `Manga_Manager-moblie-` is remote `old-mangamanager`); code was rebuilt from desktop
v0.4.1, then (2026-10-05) brought to **desktop v0.5.4 parity**: renderer +
shared replaced with v0.5.4 (translation removed again — translate/ocr/
inpaint/export, TransEditor/TransWork/WorkTransEditor/CharacterMemo,
TranslateSection, transProjects/transMemos settings), backend got the 0.5.x
main changes (ratings files, editions finder, group rename, read progress,
random/excluded browse, comic status/stall/ad-filter), app version 0.5.4.
Electron is gone. When the desktop moves on, diff `vA..vB` in manga-viewer-2
and port the same way (renderer copied, main changes hand-ported to src/backend).

## 2. Architecture (this folder)

- `src/renderer/` — the desktop React UI, nearly unchanged. Talks only to
  `window.api` (type `Api` in `src/shared/ipc.ts`). Phone tweaks:
  `mobile.ts` (isTouch/isNarrow — narrow = < 600px), `mobile.css`, reader list
  pane = overlay drawer, tooltips off on touch. Desktop leftovers are removed
  (hover preview, mouse side buttons / Alt+←→ / forward nav, global keyboard
  shortcuts + 설정 › 단축키, window-close signal, divider mouse resize, the
  desktop TabBar / WorkCard / ExitModal); `shared/shortcuts.ts` keeps only the
  reader's page keys (Bluetooth keyboards / page turners). Android back
  (App.tsx `back`): ☰ menu → topmost popup (`closeTopPopup`: long-press menu,
  dialogs, + menu, glance, open dropdown lists) → `useBackHandler` stack
  (selection; online 즐겨찾기 panel / view, search, genre/day/platform filters)
  → tab grid, 설정 · 기록 · 작업 목록 · 관리 → the full library list last shown
  (`lastLibView`: local home or online browse, current mode); reader: open list
  drawer closes first, a work / gallery picked from the sidebar rewinds to the
  one it replaced (`tab.back` / `tab.onlineBack`; chapter prev/next and
  continuous reading pass `noBack`), else the tab closes → library list; home
  with a filter / search → cleared; full home / browse → save session + exit,
  no exit popup (`exitSaving`).
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
  SeriesGridCard, OnlineFavCard (layout), Browse inline. (SeriesCard only
  provides `ChapterRow`.) Folder / 메타 채우기 / 삭제 live in the
  long-press menu (useWorkCard / useSeriesCard). ComicBrowse has no layout
  toggle (wide tiles, no 더보기); its 인증창 / 주소 / 비상용 fold out from a
  chevron at the right end of the filter row (`.filter-bar`); filters fold into centered short buttons
  (만화: 장르; 웹툰: 분류 · 요일 · 장르 · 플랫폼 — `cat` (all / bl / adult, none =
  the site default 일반) / `day` / `plat` URL params, platform
  list scraped from the page's 플랫폼 row, genre chips from the 장르 row).
  Genres are multi-select (comma-joined `source.genre`; 만화 `g=a,b`, webtoon
  `tag=<id>,<id>` with ids learned from in-page clicks → `webtoonTags`); day /
  platform stay single. Chosen filters show as removable `.search-chips` under
  the dropdowns. (Genre/platform tags on download: postponed — `comicSeriesMeta`
  scrapes them but nothing uses it yet.) `ConfirmModal` portals to body (`compact` =
  text-only dialog).
  Thumbnails (phone): every cover box uses `--thumb-ratio` (338/480, a typical
  cover, gallery 4224126) and the image fills the box WIDTH (taller → cropped
  top/bottom, wider → letterboxed top/bottom) — end of mobile.css.
  Settings rows with several buttons use `SettingRow stack`.
  관리 (phone): no ← 홈, tabs = `.chips` divider row, actions / card actions =
  `flat-group` text buttons, groups split by lines, cards 2 per row. 작업 목록
  (Download.tsx) = the list only (manual 동인지 다운로드 pane removed), head
  icon buttons 전체 정지 · 전체 시작 · 완료 지우기, rows split by lines.
  Tab bar = `MobileTabBar.tsx`: ☰ · 라이브러리 · 온라인, a one-tab-at-a-time swipe strip
  (scroll-snap, swiping never switches tabs), Chrome-style tab-count button →
  2-column tab grid (`tabSwitcherOpen`). Mode switch / 작업 목록 / 설정 are in
  the ☰ menu only. 기록 (menu, view `history`) = Home in history mode: local
  works by `lastViewedAt` + online works from `onlineHistory` (backend
  `history.json`, recorded in store.openOnline/openComic), newest first.
  Reader (phone): title/bottom bars overlay the pages (`.overlay-bars`), hide
  on a drag / tap-flip, a tap toggles them in the center (paged: middle third × middle 40%; scroll: anywhere with 넘김 OFF, the middle third band with 하단 넘김 — bottom third scrolls, top third idle); bars also come back on a drag starting in the top / bottom 32px of the pages moving inward (`edgeSwipe`), on the last page (paged/spread), and on reaching the bottom in scroll mode (a drag there doesn't re-hide them); no artist in the title bar
  (online = globe icon; local works get a favorite heart instead of 폴더 열기; the heart = that work / chapter); bottom bar = slider + ⋮, which (or a swipe up) expands
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
  Library screens (Home incl. 기록, Browse, ComicBrowse) use
  `components/libraryTools.tsx`: `usePullRefresh` (children slide by --ptr,
  spinner above the search box; Home = page 1 + `scanLibraryJob`, online = page
  1 + reloadKey fetch), `LibraryFab` (portaled round +, hides on scroll down,
  drop-up 새로고침 / 작품 선택 / 페이지 이동 — `pager` prop, a number dialog that jumps the screen's list page; 일반 만화 online has no total, so any number, overshoot lands on the last), `useSelection` + `SelectBar` (fixed to the bottom edge, portaled; 전체
  선택 · 해제 | 삭제(local) / 다운로드(online, sequential) | ×) — cards carry
  `data-sel` + checkbox via `useSel`/`SelBox`; Android back ends selection
  (`popBack`).
  Pull paging (`usePullRefresh(ref, refresh, on, pager)`): pull down at the top
  = 새로고침 on page 1, previous page (↑) after; pull up past the bottom = next
  page (↓, icon fixed to the list's bottom edge). 작품 통합 (`merge.ts`):
  SelectBar Merge icon (Home) → a manual collection (`settings.manualCollections`,
  folders untouched, scanner folds them into one Work with `sources`); long-press
  → 통합 해제. deleteWork on a collection removes only its `sources` (its `path`
  is their parent). `toast.ts` showToast = small bottom pill ("코드 복사 완료").
  Folder names are capped by `backend/lib/nameFit.ts` (80 chars / 180 UTF-8
  bytes; doujin names shorten the title first, never the code) — ext4 255-byte
  limit + Windows MAX_PATH when copied to a PC / NAS. 분할 뷰 menu items are
  tablet-only (`isNarrow()`).
  Swipe left on 라이브러리 → 온라인, right on 온라인 → 라이브러리 (`useSwipeNav`).
  The new screen slides in from that side (`swipeSlide` → `.slide-from-*`).
  The open ☰ menu / reader list drawer follows a leftward drag (`useSwipeClose`:
  drawer + its toggle move, backdrop fades); past 1/3 of its width or a flick
  closes it, otherwise it springs back.
  격자형 cards: cover in a 6px `--bg-1` frame (card background), fixed text rows
  (title 2 lines, artist 1, meta 1 — rendered even when empty) → equal heights.
  Toolbar extras (즐겨찾기 view toggle + sort, home artist/tag filter chips) are
  rendered twice: `.chips-extra` inline (tablet; the row may wrap) and a
  `.chips-extra-row` under the toolbar (phone). Theme: `localStorage['mm-theme']`
  is applied by index.html before render and `MM.setTheme` stores it natively
  (MainActivity paints the WebView background) — no light flash at start.
  Reader scroll mode keeps the whole work mounted (≤ 400 pages, else a ±30
  window in steps of 10; `scrollWin` / memoized `scrollPages`, PageSlot holds
  the estimated height until its image loads) and local works prefetch every
  page once — slider drags never wait for reloads. Pull past the ends shows a
  round arrow button whose ring fills purple (`.edge-pull`, --p 0..1).
  Toolbar rows (home / online `.chips`, filter buttons, reader ⋮ row) never
  wrap: fixed controls keep size + place (site-tools ⌄ pinned right), only the
  즐겨찾기 chip ellipsizes, and below 400px the rows step down in zoom (to 0.9×
  at ≤340px). Online list grid columns are `minmax(min(320px, 100%), 1fr)`.
  Tablet (≥ 600px, end of mobile.css): list tiles = one full-width column,
  grid cards keep 189px and auto-fill (leftover = side margins), several tabs
  side by side (`--tab-w` from MobileTabBar: 150–260px, shrinking Chrome-style
  with more tabs down to 2/3, animated, then the strip scrolls), reader list
  docked beside the pages at 78% of the drawer width (no scrim / outside-tap
  close; drag-left still closes it; list button defaults to the floating
  toggle — `sidebarBtnMode`: `settings.sidebarBtn` else phone 'bar' / tablet
  'float'). The site-tools ⌄ stays at the right end of the filter row on
  every width. Phone (< 600px) unchanged.
  Focus mode in the reader (`.app.focus-reader`): the tab bar is position:
  fixed over the top (slides up when hidden) so the reader never resizes;
  the title bar sits at `--mtabbar-h`, scroll mode pads the top by it.
  Library side padding 12px; phone hides scrollbars (the desktop 12px custom
  scrollbar took layout room → uneven margins); reader pages 4px each side.
  Online download progress = thin bar on the card's top edge (`.gcard > .gcard-dlbar`).
  Reader taps: single tap fires after 130ms (a finger-down in that window
  waits for a double tap); no ‹ › page hints. Sidebar toggle: long-press +
  drag moves it, saved as `settings.listToggleTop` (px from the reader top,
  default 60); `settings.readerSidebar` off hides drawer + toggle.
  `settings.sidebarBtn` (`sidebarBtnMode`; unset = phone 'bar' / tablet
  'float'): 'bar' = ☰ at the left of the reader bottom bar opens the list,
  floating edge toggle hidden (`.reader-split.toggle-bar`); 'float' = the
  draggable edge toggle. `settings.focusMode`: hiding the reader
  bars also folds the tab bar away (`body.focus-hide-tabs`, margin-top =
  -measured height). Both switch from the ⋮ row (left end: 버튼/플로팅, right
  end: 포커스) and 설정 › 뷰어 스타일. Sidebar chapter rows: title (ellipsis) +
  heart/group on line 1, rating bottom-right (online `.chapter-sub`, local end
  of the tags row); rows are `flex-shrink: 0` (overflow:hidden otherwise let
  the column squeeze them). Scroll-mode
  slider follows scroll fractionally (`syncSliderRef`, DOM writes, re-applied
  in a layout effect after each render).
  Reader chapter navigation (`chNav`: online comic siblings or local series):
  bottom bar = slider · page · ⋮, then a centered row ‹ 현재 화 (n / total) ›;
  ⋮ opens mode / fit / 넘김. Scroll mode, touch: pulling 130px past the
  bottom / top (`trackEdgePull`, round `.edge-pull` button) → next / previous chapter
  (`continueRef`; going back sets `startAtBottom` → lands on the last page);
  paged past the ends does the same.
  Online comic sidebar head = the local one: full-width 시리즈 · N화 label with
  the series heart at the right end (`toggleNormalUnifiedFav`), no ← 홈.
  Favorite / 기록 cards (`OnlineFavCard`) open a comic series by fetching its
  chapters → last-read (or first) chapter with `seriesUrl` attached.
  Chapter lists (online comic sidebar `ComicChapterList`, local `ChapterRow`):
  every chapter opened before (`readProgress`) gets `.read` = light purple
  tint; the last read keeps `.last-read` (purple outline); open = `.active`.
  Opening / leaving the reader, opening 관리 / 작업 목록 replays the mode-switch blur (App.tsx,
  `.mode-switching`).
  Tab strip: new tabs animate in (held 'pre-enter' two frames so the reader's
  mount frame doesn't eat it); tab grid has open/close animations.
  Popups: no frame, no top icon (`.exit-modal .exit-icon` hidden), left text,
  flat text action buttons bottom-right (primary purple / danger red); dialog
  buttons in `.dl-modal` / `.grp-pop` are flat too (mobile.css end).
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
    comic WebView control, toast/exit.
  - `Net.java`: OkHttp. kind `doujin` = DoH (1.1.1.1 by IP) + UA/Referer;
    `comic` = WebView cookies + UA + site Referer; disk image cache (budget = `settings.imageCacheGB`, default 0.5 GB, set via
    `setImageCache` from applyNetwork; LRU by mtime, touched on hit, trimmed
    to 90% in the background every ~16MB written; 0 = no cache). 설정 › 관리 ›
    이미지 캐시 shows usage + 캐시 비우기.
  - `MMWebViewClient.java`: serves `https://localhost/_mm/{img|web|comic}/<b64url>`
    (local file / doujin image / comic image) — replaces desktop `mangaimg://`.
  - NAS (WebDAV / SMB): a NAS folder is the path `/nas/<connId>/<rel>`; every
    fs method (and `httpDownload` / `imageToFile` / the `/_mm/img/` server)
    goes through `Vfs.java`, which sends those to `WebDavFs` (OkHttp,
    PROPFIND/GET/PUT/MKCOL/DELETE/MOVE, Basic auth, optional trust-all TLS) or
    `SmbFs` (smbj). Connections + passwords live in `NasStore`
    (EncryptedSharedPreferences); JS sees them without passwords
    (`nasList/nasTest/nasSave/nasRemove`, `listDirs`). Remote reads are cached
    in the 400MB image cache (`Net.cachedNas`); downloads to a NAS go to a
    local temp file, then upload. Settings: 폴더 · NAS 연결 list; "+ 폴더 추가"
    asks 이 기기 / NAS · <name> / + NAS 연결 (`NasDialogs.tsx`, `nas.ts`
    displayPath). App allows cleartext http (LAN NAS). `ensureStorage(paths)`
    skips the storage permission when all paths are NAS.
  - `Tunnel.java`: SNI-bypass local CONNECT proxy (desktop green-tunnel
    equivalent: DoH + ClientHello split into 40-byte TLS records). On when
    `settings.bypassTunnel`; comic OkHttp client + every WebView (ProxyController)
    go through it.
    WebViews start DIRECT even with it on (`MMPlugin.webTunnel`); ComicWeb
    switches them to the tunnel only after a main-frame connect error
    (`webTunnelFallback`, once per setNetwork). OkHttp comic client always uses it.
    Cloudflare's challenge fails through it (2026-10-09, toki33): the
    fragmented ClientHello gets the verify widget stuck / looping. Direct
    (tunnel off) the WebView uses ECH (encrypted SNI) on Cloudflare sites, so it
    connects even where the SNI is blocked and passes the challenge. A
    one-record TCP split was tried: the ISP's DPI reassembles it (connection
    closed). challenges.cloudflare.com bypasses the tunnel.
  - `ComicWeb.java`: hidden scraper WebView kept BEHIND the app WebView;
    brought to front for Cloudflare / manual browsing (title bar + 닫기).
    Plain WebView UA, no doc-start overrides (Cloudflare blocks a UA / client-hint
    mismatch or a patched navigator). JS drives it via
    comicLoad/comicState/comicEval (`backend/lib/comic.ts`).
- Data: app-private files dir (settings/works/online json, thumbs). First run
  sets download dirs to `Download/MangaManager/{doujin,manga}`.
  `settings.hideFromGallery` (default on, 설정 › 폴더): `backend/gallery.ts` keeps a
  `.nomedia` in both download dirs (startup, settings save, each download) and
  `MM.mediaScan` rescans them so the phone gallery drops / regains the pages.

Known gaps / TODO: downloads run in WebView JS (stall when app backgrounded —
needs a foreground service); UI still desktop-shaped in places (home/browse
toolbars, tab bar, settings); no update check; app icon = `app.png` (repo root) rendered into the mipmap
folders (adaptive foreground full-bleed, white background, + legacy square/round);
comic online not tested against the live site (needs the user's address).

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
— `MangaViewAndroid-2112240502.zip` (source of a manacomic viewer: WebView
captcha → cookies → OkHttp) and `Pupil-v5.3.23.apk` (doujin client; decompile
with jadx; same gg.js logic as desktop `doujin.ts`).

## 3. Domain knowledge to carry over (from the desktop app)

**Naming (2026-10-06):** this repo never spells the online sources' site
names in identifiers / class names / file names / comments: the doujin source
is `doujin` (`DoujinMeta`, `api/doujin.ts`, `isDoujin`…), the general-manga
source is `comic` (`ComicBrowse`, `comicBaseUrl`, `ComicWeb.java`…). The
desktop app is being renamed the same way; no more code is ported from it.
Data saved by ≤0.5.4 is migrated on load
(`backend/lib/legacyNames.ts`). No site string is in the source at all: names
the app must recognise are 64-bit FNV-1a fingerprints (`backend/lib/fp.ts`)
compared against what it sees — the typed doujin address (→ CDN host + the
site origin, passed as `doujinSite` to `MM.setNetwork` for Net.java's
Referer/Origin; the CDN 404s without it, so a CDN-only address errors), old
`meta.<site>.json` sidecars (new ones are `meta.doujin.json`), and pre-0.5.5
setting keys / values. Compute a fingerprint in a shell, never in a file.

Two library modes:

- **doujin** — doujinshi galleries identified by a numeric gallery code.
  Online: index/search via nozomi files + gallery JS; image URLs come from
  the site's `gg.js` (desktop: the doujin-site lib under `src/main/lib/`).
  The domain is DNS-blocked in Korea → the desktop resolves hosts via DoH
  (Cloudflare 1.1.1.1 by IP) and connects to the IP directly. Requests need a
  doujin Referer. The site address is user-entered (`doujinBaseUrl`).
- **normal (general manga / webtoon)** — a "comic"-family site (React SPA,
  domain changes often; user-entered `comicBaseUrl`). Behind a
  Cloudflare-style check the user clears once in a visible browser window;
  the desktop scrapes it with a hidden Chromium window (its comic-site lib).
  List state is in the URL: `/manhwa|/ing ?g=<genre>&sort=<fresh|hot|views|rating|episodes>&page=N`,
  search `/search?q=&field=title|author&match=contains|exact&page=N`, chapter
  list paged by `?epage=N`, viewer images = `img.viewer-lazy-img[data-src]`.
  Some ISPs reset TLS by SNI for the site domain; its DNS CNAME (a BunnyCDN
  host) serves the same site unblocked. (Desktop 0.4.1
  tried switching to it automatically; reverted in 0.4.2 — not used now.)
- A "backup" gnuboard-style site can be scraped by hand (user navigates, app
  reads the chapter list) — `ComicBackupModal`.

Favorites model (desktop, 2026-10): one heart per gallery — the favorites list
keyed by doujin code; local copies mirror it; general-manga series favorites
are linked to online ones by normalized title. Favorites file = Pupil-compatible
JSON `{favorites:[ids], favorite_tags:[{area,tag}], ranks:{code:n}}` — the
natural format for desktop ⇄ mobile sync.

## 4. Working with this user

- Korean, terse ("caveman") replies. UI strings are Korean.
- **Commits only when asked**; messages are subject-only, **no
  `Co-Authored-By` / Claude trailers** (the user removed them from history).
  Git identity: `alterstare <alterstare03@gmail.com>`.
- Release flow (mobile): bump `version` in package.json + `versionCode` /
  `versionName` in android/app/build.gradle → `npm run sync` → `gradlew
  assembleRelease` (signed with `~/.halftone/keystore.properties` + keystore —
  a copy of this PC's debug keystore, so it updates over earlier debug installs;
  keep `~/.halftone` backed up, a different key can't update installed apps) →
  copy to `Halftone-vX.Y.Z.apk` (repo root, git-ignored) → commit → push → tag
  `vX.Y.Z` → GitHub release with the APK attached (no `gh` here: REST API with
  the git credential token). The app's auto-update (`src/backend/update.ts`)
  reads `releases/latest` (skipped when `settings.autoUpdate` is off — 설정 · 관리 · 업데이트) and needs a published (non-draft) release with an
  `.apk` asset whose tag is newer than the installed versionName.
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
