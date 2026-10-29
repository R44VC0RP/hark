import { useSyncExternalStore } from "react";

/** Seasonal theme set on <html data-theme> by /theme.js before first paint. */
export type SiteTheme = "default" | "halloween";

const CHANGE = "hark:theme";
const STORAGE_KEY = "hark.theme";

function currentTheme(): SiteTheme {
  return document.documentElement.dataset.theme === "halloween" ? "halloween" : "default";
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  return () => window.removeEventListener(CHANGE, onChange);
}

/**
 * The active seasonal theme. Prerendered markup is the default theme; the
 * real value applies after hydration (colors already apply from CSS).
 */
export function useSiteTheme(): SiteTheme {
  return useSyncExternalStore(subscribe, currentTheme, () => "default");
}

function applyTheme(theme: SiteTheme) {
  if (theme === "halloween") document.documentElement.dataset.theme = "halloween";
  else delete document.documentElement.dataset.theme;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, theme);
  } catch {}
  window.dispatchEvent(new Event(CHANGE));
}

const BAT =
  "M32 8c2-3 4-3 5 0 3-4 9-7 15-6-3 2-4 5-3 8 3-1 7 0 10 3-5 0-8 2-10 5-2-3-6-4-9-2-2-2-5-3-8-3s-6 1-8 3c-3-2-7-1-9 2-2-3-5-5-10-5 3-3 7-4 10-3 1-3 0-6-3-8 6-1 12 2 15 6 1-3 3-3 5 0z";
const SVG_NS = "http://www.w3.org/2000/svg";
/** When the colors switch, while the dusk overlay is darkest. */
const SWITCH_AT_MS = 520;
const DONE_AT_MS = 1700;
let switching = false;

/**
 * Flips between the default and Halloween themes. With motion allowed, the
 * page dims to dusk (or brightens back), a swarm of bats sweeps across, and
 * the colors change at the darkest moment; otherwise it switches at once.
 */
export function toggleSiteTheme() {
  const next: SiteTheme = currentTheme() === "halloween" ? "default" : "halloween";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    applyTheme(next);
    return;
  }
  if (switching) return;
  switching = true;

  const overlay = document.createElement("div");
  overlay.className = `hark-dusk ${next === "halloween" ? "is-dusk" : "is-dawn"}`;
  overlay.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 16; index += 1) {
    const bat = document.createElementNS(SVG_NS, "svg");
    bat.setAttribute("viewBox", "0 0 64 28");
    bat.setAttribute("class", "hark-swarm-bat");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", BAT);
    bat.appendChild(path);
    // Every bat starts low on the left and leaves high on the right, on its
    // own line, size and timing, so the swarm looks loose rather than drilled.
    const startY = 55 + Math.random() * 45;
    const endY = -20 + Math.random() * 50;
    bat.style.setProperty("--y0", `${startY}vh`);
    bat.style.setProperty("--y1", `${endY}vh`);
    bat.style.setProperty("--x-wobble", `${-8 + Math.random() * 16}vw`);
    bat.style.setProperty("--size", `${26 + Math.random() * 46}px`);
    bat.style.setProperty("--delay", `${Math.random() * 380}ms`);
    bat.style.setProperty("--flap", `${110 + Math.random() * 70}ms`);
    overlay.appendChild(bat);
  }
  document.body.appendChild(overlay);
  window.setTimeout(() => applyTheme(next), SWITCH_AT_MS);
  window.setTimeout(() => {
    overlay.remove();
    switching = false;
  }, DONE_AT_MS);
}
