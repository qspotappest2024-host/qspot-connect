// QSpot web — light/dark theme for the Premium, account and legal pages.
// Loaded in <head> (not deferred) so the saved theme is applied before the
// page paints. Shares the marketing site's choice: localStorage "qspot-theme"
// = "dark" | "light", or nothing = follow the device. Same key, same
// data-theme attribute as website/js/app.js, so a choice made on either side
// carries over. localStorage can throw (private mode, blocked storage), so
// every access is guarded and the page still follows the device without it.
(function () {
  var KEY = "qspot-theme";
  var html = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function stored() {
    try { var v = localStorage.getItem(KEY); return v === "dark" || v === "light" ? v : null; }
    catch (_e) { return null; }
  }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (_e) { /* per-viewer convenience only */ } }
  function isDark() {
    var t = html.getAttribute("data-theme");
    return t === "dark" || (t !== "light" && !!(mq && mq.matches));
  }

  var s = stored();
  if (s) html.setAttribute("data-theme", s);

  window.qsIsDark = isDark;

  var SUN = '<svg class="icon-sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  var MOON = '<svg class="icon-moon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  function label(btn) {
    var fr = (html.getAttribute("lang") || "").toLowerCase().indexOf("fr") === 0;
    var text = isDark()
      ? (fr ? "Passer au mode clair" : "Switch to light mode")
      : (fr ? "Passer au mode sombre" : "Switch to dark mode");
    btn.setAttribute("aria-label", text);
    btn.setAttribute("title", text);
  }
  function announce() {
    try { window.dispatchEvent(new CustomEvent("qspot-theme", { detail: { dark: isDark() } })); } catch (_e) {}
  }

  function addToggle() {
    var inner = document.querySelector(".qnav-inner");
    if (!inner || inner.querySelector(".qtheme-toggle")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "qtheme-toggle";
    btn.innerHTML = MOON + SUN;
    btn.addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";
      html.setAttribute("data-theme", next);
      save(next);
      label(btn);
      announce();
    });
    inner.appendChild(btn);
    label(btn);
    // The page language can switch after load (FR / EN links): keep the label in step.
    if (window.MutationObserver) {
      new MutationObserver(function () { label(btn); }).observe(html, { attributes: true, attributeFilter: ["lang"] });
    }
    if (mq) {
      var onChange = function () { if (!stored()) { label(btn); announce(); } };
      if (mq.addEventListener) mq.addEventListener("change", onChange); else if (mq.addListener) mq.addListener(onChange);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addToggle);
  else addToggle();
})();
