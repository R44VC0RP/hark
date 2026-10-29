// Seasonal site theme, applied before first paint so colors never flash.
// Halloween runs October 24-31 in the visitor's local time. ?theme=halloween
// or ?theme=default override it, and so does clicking the Hark logo on the
// homepage (remembered for this tab in sessionStorage "hark.theme").
(() => {
  try {
    const query = new URLSearchParams(window.location.search).get("theme");
    const chosen = window.sessionStorage.getItem("hark.theme");
    const now = new Date();
    const season = now.getMonth() === 9 && now.getDate() >= 24 ? "halloween" : "default";
    const pick = query ?? chosen ?? season;
    if (pick === "halloween") document.documentElement.dataset.theme = "halloween";
  } catch {}
})();
