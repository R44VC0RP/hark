// Seasonal site theme, applied before first paint so colors never flash.
// Halloween runs October 24-31 in the visitor's local time; ?theme=halloween
// previews it any day and ?theme=default turns it off.
(() => {
  try {
    const query = new URLSearchParams(window.location.search).get("theme");
    const now = new Date();
    const season = now.getMonth() === 9 && now.getDate() >= 24 ? "halloween" : null;
    const theme = query === "halloween" ? "halloween" : query === "default" ? null : season;
    if (theme) document.documentElement.dataset.theme = theme;
  } catch {}
})();
