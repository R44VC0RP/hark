# Building Hark Web Apps That Feel Native

Hark opens a web app full screen with no browser chrome: no address bar, no toolbar, no back
button. The page is the whole app, so it has to bring its own navigation and respect the iPhone's
edges. This guide covers what Hark does with a page and how to build one that fits.

## How Hark Shows a Page

| Page sets | Hark does | `env(safe-area-inset-*)` |
| --- | --- | --- |
| `viewport-fit=cover` in its viewport meta | Draws the page **edge to edge**: under the status bar, the Dynamic Island and the home indicator. Nothing native covers it. | The real insets (about 62 pt top and 34 pt bottom on an iPhone 17 Pro) |
| No `viewport-fit=cover` | Paints a strip under the status bar and keeps the page above the home indicator (the older behavior). | `0` |

`window.hark.edgeToEdge` is `true` while Hark draws the page edge to edge. Hark app versions
before 1.3 build 30 don't have it and never draw edge to edge, so treat a missing value as `false`.

## 1. Viewport and Safe Areas

Always opt in, and always pad with the insets. Padding with `env()` is safe in both modes: the
values are `0` whenever Hark (or a browser) is already keeping content clear of the edges.

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

```css
:root {
  --safe-top: env(safe-area-inset-top);
  --safe-right: env(safe-area-inset-right);
  --safe-bottom: env(safe-area-inset-bottom);
  --safe-left: env(safe-area-inset-left);
}
```

- **Never force the insets to `0`** inside Hark (for example `if (window.hark) inset = 0`). An app
  did exactly this and put its map buttons under the Dynamic Island. If you need to know the mode,
  read `window.hark?.edgeToEdge`; you rarely need to, because `env()` is already correct.
- Backgrounds, maps and images should run to the edges; text and buttons stay inside the insets.
- Hark is portrait-only, but keep `--safe-left` and `--safe-right` in your padding so the page also
  works in Safari in landscape.

## 2. `theme-color` and the Status Bar

Hark reads the page's first `<meta name="theme-color">` (falling back to the `<body>` background)
when the page loads, and uses it to:

- pick the **status bar text**: light text on a dark color, dark text on a light one;
- **fill** anything the page doesn't paint, such as the strip in non-edge-to-edge mode, the
  overscroll area and the space behind the page while it loads.

Rules:

- Use `#rrggbb`, `#rgb` or `rgb(r, g, b)`. Hark ignores other forms (named colors, `hsl()`,
  `oklch()`) and transparent colors.
- Make it match the color at the top of the page, under the status bar, so the text stays readable.
- Hark uses the **first** `theme-color` tag and reads it once per page load, so `media=` variants
  are not enough. Set the color with a small script in `<head>` instead. This also works in Safari:

```html
<meta name="theme-color" content="#f7f7f5">
<script>
  // Before the page renders: pick the theme color for the current scheme.
  (function () {
    var dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.querySelector('meta[name="theme-color"]').content = dark ? "#111312" : "#f7f7f5";
  })();
</script>
<style>
  :root { color-scheme: light dark; --bg: #f7f7f5; --ink: #171713; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111312; --ink: #f2f2ef; } }
  body { background: var(--bg); color: var(--ink); }
</style>
```

If the person switches between light and dark while the app is open, the status bar keeps its old
style until the page reloads. Choose colors that stay readable under both text colors, or reload
on `matchMedia(...).addEventListener("change", () => location.reload())` if it matters.

## 3. A Back Button of Your Own

Hark shows no back button. The page must show one in its own header whenever there is somewhere to
go back to, and hide it on the root screen.

- Pressing it calls `history.back()`.
- A swipe from the left edge also goes back through the page's history, and on the first page it
  returns to Hark. The button is still needed: not everyone knows the swipe.
- Don't use `history.length`; it doesn't shrink when going back. Track depth in `history.state`
  (or use your router's own state), or use the Navigation API's `navigation.canGoBack` where it
  exists.
- Make the hit area at least 44 × 44 pt, and place the header below `safe-area-inset-top`.

Copyable snippet (plain HTML, CSS and JS; works with `pushState` routers and plain links):

```html
<header class="bar">
  <button class="back" type="button" aria-label="Back" hidden>
    <svg viewBox="0 0 12 20" width="12" height="20" aria-hidden="true">
      <path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.4"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
  <h1 class="title">Groceries</h1>
</header>

<style>
  .bar {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: 4px;
    min-height: 44px;
    padding: calc(var(--safe-top) + 6px) calc(var(--safe-right) + 12px) 6px calc(var(--safe-left) + 8px);
    background: var(--bg);
  }
  .back {
    display: grid; place-items: center;
    width: 44px; height: 44px; margin-left: -6px;
    border: 0; border-radius: 22px; background: none; color: inherit;
    -webkit-tap-highlight-color: transparent;
  }
  .back[hidden] { display: none; }
  .back:active { background: rgb(127 127 127 / 0.18); }
  .title { margin: 0; font: 600 17px/1.2 -apple-system, system-ui, sans-serif; }
</style>

<script>
  // Depth of this entry in the app's own history: 0 on the first page Hark opened.
  function depth() {
    return (history.state && history.state.harkDepth) || 0;
  }
  // Same-origin page loads (plain links) continue the count from the previous page.
  if (!history.state || history.state.harkDepth === undefined) {
    var previous = Number(sessionStorage.getItem("harkDepth") || "-1");
    var cameFromHere = document.referrer && new URL(document.referrer).origin === location.origin;
    history.replaceState({ ...history.state, harkDepth: cameFromHere ? previous + 1 : 0 }, "");
  }
  // Wrap pushState so client-side routers count too.
  var push = history.pushState.bind(history);
  history.pushState = function (state, title, url) {
    push({ ...state, harkDepth: depth() + 1 }, title, url);
    update();
  };
  var back = document.querySelector(".back");
  function update() {
    var canGoBack = window.navigation && "canGoBack" in window.navigation
      ? window.navigation.canGoBack
      : depth() > 0;
    back.hidden = !canGoBack;
    sessionStorage.setItem("harkDepth", String(depth()));
  }
  back.addEventListener("click", function () { history.back(); });
  window.addEventListener("popstate", update);
  window.addEventListener("pageshow", update);
  update();
</script>
```

## 4. Fitting In

- **Full height:** size the layout with `min-height: 100dvh` (not `100vh`), so it tracks the real
  visible height.
- **Fixed headers and bottom bars:** pad them with the insets (`padding-top: calc(var(--safe-top) +
  …)`, `padding-bottom: calc(var(--safe-bottom) + …)`). Let the bar's background run into the
  inset; keep its buttons out of it.
- **Nothing on the home indicator:** no button, link or input may sit in the bottom
  `safe-area-inset-bottom`. Swipes there go to iOS, not the page.
- **Scrolling:** add `overscroll-behavior: none` on `html, body` (or `contain` on inner scrollers)
  so the page doesn't rubber-band its whole layout, and give the overscroll area the same color as
  `theme-color`.
- **No zooming on focus:** use a font size of at least 16 px for every `input`, `select` and
  `textarea`; smaller sizes make iOS zoom the page.
- **Keyboard:** open every input once and check that it, and any submit button, stay visible
  above the keyboard. A bottom bar with an input should sit at `bottom: 0` and pad with the inset,
  not with a hard-coded height.
- **Tap feel:** `-webkit-tap-highlight-color: transparent`, an `:active` state on buttons, and
  44 pt tap targets.
- **Text:** `-apple-system, system-ui` matches iOS; `font-variant-numeric: tabular-nums` for
  changing numbers.

## 5. The `window.hark` Bridge

Defined only inside the Hark iPhone app, and only on the app's registered origin:

| Member | What it does |
| --- | --- |
| `await hark.getToken()` | A signed two-minute Hark pass identifying the viewer. Send it to your server and verify it there (see the main skill, "The Hark Pass"). Rejects with `consent_required` until the viewer approves sign-in. |
| `hark.close()` | Returns to Hark. |
| `hark.edgeToEdge` | `true` while the page is drawn edge to edge (Hark 1.3 build 30 and later). |
| `hark.version` | Bridge version, currently `1`. |

- When `window.hark` is missing, the page is in a normal browser. Show "Open this in the Hark app"
  (or the app's own fallback), never a password form.
- **The Hark menu** opens with a still **two-finger hold** anywhere on the page (Back to Hark,
  Reload, Open in Safari, App info, Stop signing in). Don't use two-finger holds yourself, and
  don't call `preventDefault()` on two-finger `touchstart` events. Pinch zoom and two-finger
  scrolling are fine; any movement cancels the hold.
- **Links:** links to other sites leave the app. Hark asks the person first, then opens them in
  Safari, where the Hark sign-in doesn't apply. Keep the app's own pages on its registered origin.

## 6. Checklist Before Registering

1. The viewport meta has `viewport-fit=cover`, and nothing forces the insets to `0`.
2. `theme-color` is a hex or `rgb()` color matching the top of the page, and is set for dark mode
   if the app supports it.
3. The header shows a 44 pt back button whenever there is history, hidden on the root screen, and
   sits below `safe-area-inset-top`.
4. Fixed bars are padded by the insets; nothing tappable sits on the home indicator.
5. The layout uses `100dvh`; inputs are 16 px or larger; the keyboard doesn't hide what you type.
6. The page works without `window.hark` (shows an "Open in Hark" message), and signs in with
   `getToken()` inside Hark.
7. No two-finger hold gestures of your own.

## 7. Testing It in Hark

- **Real iPhone (the reference):** deploy over HTTPS, register with `harkctl apps create --name … --url
  https://… --json`, then open the app from Hark's home screen. Check the top and bottom edges, a
  form with the keyboard open, the back button and the two-finger hold.
- **Simulator:** the App Store version of Hark can't be installed on a simulator. In the Hark repo,
  run the Expo dev build (`apps/expo`, `pnpm start`), then open the web app with
  `hark://web/<appId>`. Plain `http://localhost` URLs register for development, but they only
  load in a simulator on the same Mac.
- **Quick layout check without Hark:** add the page to the Home Screen from Safari on an iPhone
  or in the iOS simulator, with "Open as Web App" on. It opens without browser chrome and gets the
  same edge-to-edge insets as in Hark (but no `window.hark`).
- After changing the page, pull to refresh isn't available in Hark: use the Hark menu's **Reload**.
