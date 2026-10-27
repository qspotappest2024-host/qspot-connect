// QSpot web — shared helpers (auth + Edge Function calls)
// Requires: config.js loaded first, @supabase/supabase-js v2 UMD loaded from CDN.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.QSPOT_CONFIG;

// supabase-js v2 UMD exposes window.supabase.createClient
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Page language (FR / EN) ─────────────────────────────────────────────────
// Opt-in per page: <html data-i18n="on">. Pages without it stay English and
// behave exactly as before. Charter of the French Language s. 52: the Premium
// purchase and account pages carry pre-contract disclosures, so a French reader
// gets them in French. ONE page per purpose — the French text lives beside the
// English in the same file, so the two cannot drift into separate pages.
//
// Choice order: ?lang=fr|en (also saved) → saved choice → browser language.
// Saved in localStorage as a per-viewer convenience only (guarded: it can throw).
const QS_LANG_KEY = "qspot_lang";
let _qsLang = null;
function qsI18nEnabled() { return document.documentElement.dataset.i18n === "on"; }
function qsLang() {
  if (_qsLang) return _qsLang;
  if (!qsI18nEnabled()) return (_qsLang = "en");
  const ok = (v) => v === "fr" || v === "en";
  let l = new URLSearchParams(location.search).get("lang");
  if (ok(l)) { try { localStorage.setItem(QS_LANG_KEY, l); } catch (_e) { /* private mode */ } }
  else {
    try { l = localStorage.getItem(QS_LANG_KEY); } catch (_e) { l = null; }
    if (!ok(l)) l = (navigator.language || "").toLowerCase().startsWith("fr") ? "fr" : "en";
  }
  return (_qsLang = l);
}
function qsLocale() { return qsLang() === "fr" ? "fr-CA" : "en-CA"; }

/** dict = { en: {...}, fr: {...} }. Falls back to English, then to the key. */
function qsT(dict, key, vars) {
  const l = qsLang();
  let s = (dict[l] && dict[l][key]) ?? (dict.en && dict.en[key]) ??
          (QS_COMMON_I18N[l] && QS_COMMON_I18N[l][key]) ?? QS_COMMON_I18N.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/**
 * French pass over the static markup. English stays in the HTML (it is what a
 * reader sees with JS off); elements marked data-i18n="key" get dict.fr[key].
 * innerHTML is used deliberately: the dictionary is this page's own constant
 * text (some entries carry <strong>/<a>), never user or server data.
 *   data-i18n-attr="placeholder:key;alt:key;href:key"  → attributes
 *   [data-langbar]                                       → the FR | EN switcher
 */
function qsApplyI18n(dict) {
  const l = qsLang();
  document.documentElement.lang = l === "fr" ? "fr-CA" : "en";
  if (l !== "en") {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const v = dict[l] && dict[l][el.dataset.i18n];
      if (v != null) el.innerHTML = v;
    });
    document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      el.dataset.i18nAttr.split(";").forEach((pair) => {
        const [attr, key] = pair.split(":");
        const v = dict[l] && dict[l][key];
        if (attr && v != null) el.setAttribute(attr, v);
      });
    });
    const title = dict[l] && dict[l]["doc_title"];
    if (title) document.title = title;
  }
  // French readers get the "QSpot Marché" lockup wherever the Marketplace logo shows.
  if (l === "fr") {
    document.querySelectorAll('img[src*="qspot-marketplace-square.svg"]').forEach((img) => {
      img.src = img.getAttribute("src").replace("qspot-marketplace-square.svg", "qspot-marche-fr-square.svg");
      img.alt = "QSpot Marché";
    });
    document.querySelectorAll('img[src*="qspot-marketplace-horizontal.svg"]').forEach((img) => {
      img.src = img.getAttribute("src").replace("qspot-marketplace-horizontal.svg", "qspot-marche-fr-horizontal.svg");
      img.alt = "QSpot Marché";
      const w = parseFloat(img.getAttribute("width"));
      if (w) img.setAttribute("width", String(Math.round(w * 1320 / 1710)));
    });
  }
  document.querySelectorAll("[data-langbar]").forEach((bar) => {
    const here = (code) => { const u = new URL(location.href); u.searchParams.set("lang", code); return u.pathname + u.search + u.hash; };
    bar.innerHTML = l === "fr"
      ? `<span class="cur">Français</span> &nbsp;|&nbsp; <a href="${here("en")}">English</a>`
      : `<a href="${here("fr")}" lang="fr">Français</a> &nbsp;|&nbsp; <span class="cur">English</span>`;
  });
}

// Strings shared by every opted-in page (the sign-in card).
const QS_COMMON_I18N = {
  en: {
    login_title: "Sign in to continue",
    login_sub: "Use the same account you use in the QSpot app.",
    login_google: "Continue with Google",
    login_apple: " Continue with Apple",
    login_hme: 'Signed up in the app with Apple and "Hide My Email"? Use <strong>Continue with Apple</strong> here so your accounts match.',
    login_patent: "U.S. Patent Pending",
    login_failed: "Sign-in didn't finish. Please try again.",
  },
  fr: {
    login_title: "Connectez-vous pour continuer",
    login_sub: "Utilisez le même compte que dans l'application QSpot.",
    login_google: "Continuer avec Google",
    login_apple: " Continuer avec Apple",
    login_hme: "Inscrit dans l'application avec Apple et « Masquer mon adresse courriel »? Utilisez <strong>Continuer avec Apple</strong> ici pour que vos comptes correspondent.",
    login_patent: "Brevet américain en instance",
    login_failed: "La connexion n'a pas abouti. Veuillez réessayer.",
  },
};

// ─── Pricing ─────────────────────────────────────────────────────────────────
// 🔴 THE PRICE IS FETCHED, NEVER WRITTEN HERE. On 2026-09-07 the same figures
//    were hand-written in 114 places across the app, the emails, three web
//    pages and the Terms of Service, and nothing compared any of them to
//    Stripe — the only one that charges. get-pricing reads the two configured
//    Stripe prices and derives everything else.
//
// ⚠️ NO STALE FALLBACK, DELIBERATELY. If the fetch fails these pages show an
//    unavailable state rather than a number that might be wrong. The figure
//    appears in consent copy — "charged only when the trial ends" sits beside
//    it — and a wrong number in the sentence that obtains agreement to be
//    charged is worse than no number.
const PRICING_URL = `${SUPABASE_URL}/functions/v1/get-pricing`;
let _pricing = null;

/** Fetches the live price list once per page load. Returns null on any failure. */
async function loadPricing() {
  if (_pricing) return _pricing;
  try {
    const res = await fetch(PRICING_URL, { headers: { "Content-Type": "application/json" } });
    if (!res.ok) { console.error("get-pricing HTTP", res.status); return null; }
    const p = await res.json();
    if (!p || !p.monthly || typeof p.monthly.amountCents !== "number") return null;
    _pricing = p;
    return p;
  } catch (e) {
    console.error("get-pricing fetch failed:", e);
    return null;
  }
}

/**
 * The pricing already fetched, or null. SYNCHRONOUS on purpose.
 *
 * ⚠️ Render paths must not be made `async` just to read a price. account.html's
 *    renderManage() is a plain function called from several places; awaiting
 *    inside it was a SyntaxError caught by `node --check`, and making it async
 *    would have spread `await` through every caller. Instead init awaits
 *    loadPricing() once, and render paths read the cached value here.
 *
 * 🔴 Returns null until that first await resolves — callers must handle null by
 *    omitting the figure, never by substituting one.
 */
function pricingNow() { return _pricing; }

/**
 * Formats integer cents in the reader's own locale.
 * ⚠️ Intl decides where the symbol goes — `CA$90.00` in en-CA, `90,00 $` in
 *    fr-CA. Hard-coding one arrangement is how a French reader gets English
 *    punctuation; that is the same defect as hard-coding the amount, one layer
 *    down.
 */
function formatMoney(cents, currency) {
  const cur = (currency || "cad").toUpperCase();
  try {
    return new Intl.NumberFormat(qsI18nEnabled() ? qsLocale() : (navigator.language || "en-CA"), {
      style: "currency", currency: cur,
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch (_e) {
    return `${cur} ${(cents / 100).toFixed(2)}`;   // last resort, still no invented amount
  }
}

/** Same, but always two decimals — for legal and consent copy. */
function formatMoneyExact(cents, currency) {
  const cur = (currency || "cad").toUpperCase();
  try {
    return new Intl.NumberFormat(qsI18nEnabled() ? qsLocale() : (navigator.language || "en-CA"), {
      style: "currency", currency: cur,
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch (_e) {
    return `${cur} ${(cents / 100).toFixed(2)}`;
  }
}

/** Returns the current session or null. */
async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

/**
 * Starts an OAuth login, returning the user to the current page afterwards.
 * IMPORTANT for Sign in with Apple users who chose "Hide My Email":
 * they must use Apple here too, or a second account will be created.
 */
async function signInWith(provider) {
  await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.href.split("?")[0] },
  });
}

// ─── Sign in with an ID token (Google / Apple) ───────────────────────────────
// Google's sign-in screen names whoever receives the result. signInWithOAuth
// sends the user through Supabase, so Google said "continue to
// lrvrmcmuhkdqhtxoumij.supabase.co". Here the browser gets an ID token straight
// from Google / Apple for OUR client IDs and hands it to Supabase
// (signInWithIdToken), so the screen names QSpot Marketplace. Same accounts as
// the apps (which already sign in this way): Supabase matches provider + subject.
//
// Nonce: Supabase hashes the raw nonce (SHA-256, hex) and compares that with
// the token's nonce claim — so Google and Apple get the HASH, Supabase the RAW.
//
// Each path falls back to signInWith() (the OAuth redirect) when its ID is not
// in config.js or its script fails to load, so a page never loses sign-in.
const QS_GOOGLE_ID = window.QSPOT_CONFIG.GOOGLE_WEB_CLIENT_ID || "";
const QS_APPLE_ID  = window.QSPOT_CONFIG.APPLE_SERVICES_ID || "";
const QS_GIS_SRC   = "https://accounts.google.com/gsi/client";
const QS_APPLE_SRC = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

const _qsScripts = {};
function qsScript(src) {
  if (!_qsScripts[src]) {
    _qsScripts[src] = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { delete _qsScripts[src]; reject(new Error(`could not load ${src}`)); };
      document.head.appendChild(el);
    });
  }
  return _qsScripts[src];
}

function qsHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** { raw, hashed }: raw goes to Supabase, hashed (SHA-256 hex) to Google/Apple. */
async function qsNonce() {
  const raw = qsHex(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return { raw, hashed: qsHex(new Uint8Array(digest)) };
}

function qsCanUseIdTokens() {
  return !!(window.crypto && crypto.subtle && crypto.getRandomValues && window.TextEncoder);
}

/** Exchanges a provider ID token for a Supabase session, then reloads the page signed in. */
async function qsFinishIdToken(provider, token, rawNonce, fullName) {
  const { data, error } = await sb.auth.signInWithIdToken({ provider, token, nonce: rawNonce });
  if (error) throw error;
  // Apple sends the name once, on the first sign-in, and never inside the
  // token. The OAuth flow stored it as full_name; keep doing that.
  if (fullName && !(data && data.user && data.user.user_metadata && data.user.user_metadata.full_name)) {
    try { await sb.auth.updateUser({ data: { full_name: fullName } }); } catch (_e) { /* name is optional */ }
  }
  // Same landing as the OAuth redirect: this page, without its query string
  // (?cancelled=1 and the like), keeping any #anchor.
  if (window.location.search) history.replaceState(null, "", window.location.pathname + window.location.hash);
  window.location.reload();
}

function qsLoginFailed(noticeEl, err) {
  console.warn("Sign-in failed:", err);
  setNotice(noticeEl, "error", qsT({}, "login_failed"));
}

/** Replaces the plain Google button with Google's own (Google Identity Services). */
async function qsMountGoogle(card) {
  if (!QS_GOOGLE_ID || !qsCanUseIdTokens()) return;
  try { await qsScript(QS_GIS_SRC); } catch (_e) { return; }
  const gid = window.google && google.accounts && google.accounts.id;
  if (!gid) return;
  const slot = card.querySelector("#login-google-gis");
  const plain = card.querySelector("#login-google");
  const notice = card.querySelector("#login-notice");
  const nonce = await qsNonce();
  gid.initialize({
    client_id: QS_GOOGLE_ID,
    nonce: nonce.hashed,
    ux_mode: "popup",
    auto_select: false,
    itp_support: true,
    callback: async (resp) => {
      hide(notice);
      try { await qsFinishIdToken("google", resp.credential, nonce.raw); }
      catch (e) { qsLoginFailed(notice, e); }
    },
  });
  show(slot);
  const width = Math.max(200, Math.min(400, Math.floor(slot.clientWidth || 320)));
  // Google's dark button in dark mode (theme.js sets window.qsIsDark and fires
  // "qspot-theme" when the sun/moon toggle or the device setting changes).
  const render = () => {
    const dark = typeof window.qsIsDark === "function" && window.qsIsDark();
    slot.innerHTML = "";
    gid.renderButton(slot, {
      type: "standard", theme: dark ? "filled_black" : "outline", size: "large", shape: "rectangular",
      text: "continue_with", logo_alignment: "center", width,
      locale: qsLang() === "fr" ? "fr_CA" : "en",
    });
  };
  render();
  window.addEventListener("qspot-theme", render);
  hide(plain);
}

/** Points the Apple button at Sign in with Apple JS (popup) instead of the redirect. */
async function qsMountApple(card) {
  if (!QS_APPLE_ID || !qsCanUseIdTokens()) return;
  try { await qsScript(QS_APPLE_SRC); } catch (_e) { return; }
  if (!(window.AppleID && AppleID.auth)) return;
  const btn = card.querySelector("#login-apple");
  const notice = card.querySelector("#login-notice");
  let nonce = await qsNonce();
  const init = () => AppleID.auth.init({
    clientId: QS_APPLE_ID,
    scope: "name email",
    // Must be listed under the Services ID's Return URLs, even for the popup.
    redirectURI: window.location.origin + window.location.pathname,
    usePopup: true,
    nonce: nonce.hashed,
  });
  init();
  btn.onclick = async () => {
    hide(notice);
    btn.disabled = true;
    try {
      // signIn() must be the first thing awaited: popup blockers only allow
      // a window opened directly from the click.
      const res = await AppleID.auth.signIn();
      const n = res.user && res.user.name;
      const fullName = n ? [n.firstName, n.lastName].filter(Boolean).join(" ") : "";
      await qsFinishIdToken("apple", res.authorization.id_token, nonce.raw, fullName);
    } catch (e) {
      btn.disabled = false;
      nonce = await qsNonce();
      init();
      const code = e && e.error;
      if (["popup_closed_by_user", "user_cancelled_authorize", "user_trigger_new_signin_flow"].includes(code)) return;
      qsLoginFailed(notice, e);
    }
  };
}

async function signOut() {
  await sb.auth.signOut();
  window.location.reload();
}

/**
 * Signs the user out EVERYWHERE — this browser, the mobile apps, every device.
 *
 * Calls the sign-out-all-devices Edge Function, which revokes all Supabase
 * sessions, deletes every push token, and clears MFA device trust (so the next
 * sign-in on any device requires a fresh SMS code).
 *
 * Returns { ok, status, data }. The caller owns the UI. This function does NOT
 * reload — callers usually want to show a confirmation first.
 *
 * ⚠️ Two things worth knowing:
 *  - Other devices are not kicked out instantly. Supabase revokes *refresh*
 *    tokens; an access token already issued stays valid until it expires
 *    (~1 hour), so a phone mid-session keeps working until its next refresh.
 *  - The local sign-out below is best-effort: once the server revokes globally,
 *    this browser's own token is dead too, so sb.auth.signOut() can throw. The
 *    session is gone either way.
 */
async function signOutAllDevices() {
  const result = await callFn("sign-out-all-devices", {});
  if (result.ok) {
    try { await sb.auth.signOut(); } catch (_e) { /* already revoked server-side */ }
  }
  return result;
}

/**
 * Calls a Supabase Edge Function with the user's JWT.
 * Returns { ok, status, data } — data is parsed JSON (or {} on parse failure).
 */
async function callFn(name, body) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${session.access_token}`,
      "apikey": SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  return { ok: res.ok, status: res.status, data };
}

/** Loads the signed-in user's subscription fields from public.users. */
async function loadSubscriptionRow() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await sb
    .from("users")
    // F45: cancel_at_period_end is REQUIRED here. Without it account.html cannot tell a
    // cancelled membership from a renewing one and renders "Renews <date>" to a member
    // who has already cancelled — the exact opposite of the truth.
    .select("subscription_status, subscription_interval, premium_until, scheduled_subscription_interval, cancel_at_period_end, display_name, marketing_emails_opt_out, stripe_subscription_id")
    .eq("id", session.user.id)
    .single();
  if (error) {
    console.error("loadSubscriptionRow:", error);
    return null;
  }
  return data;
}

function isPremiumStatus(status) {
  // past_due included: the subscription is still live (Stripe is retrying the
  // card) — these users must land on the MANAGE page to update their card,
  // never on the purchase page (which would create a duplicate subscription).
  return status === "active" || status === "trialing" || status === "past_due";
}

function formatDate(epochMs) {
  if (!epochMs || epochMs <= 0) return "-";
  return new Date(epochMs).toLocaleDateString(qsLocale(), {
    year: "numeric", month: "long", day: "numeric",
  });
}

/** Standard login card markup — call inside a container element. */
function renderLoginCard(container) {
  const c = (k) => qsT({}, k);   // QS_COMMON_I18N in the page's language (English when not opted in)
  container.innerHTML = `
    <div class="card">
      <h2>${c("login_title")}</h2>
      <p>${c("login_sub")}</p>
      <div id="login-notice" class="notice hidden" role="alert"></div>
      <div id="login-google-gis" class="gis-slot hidden"></div>
      <button class="oauth" id="login-google">${c("login_google")}</button>
      <button class="oauth apple" id="login-apple">${c("login_apple")}</button>
      <p style="margin-top:12px;font-size:0.8rem;">${c("login_hme")}</p>
      <p style="margin-top:14px;font-size:0.75rem;text-align:center;">
        <a href="/web/patents.html" style="text-decoration:underline;">${c("login_patent")}</a>
      </p>
    </div>`;
  container.querySelector("#login-google").onclick = () => signInWith("google");
  container.querySelector("#login-apple").onclick  = () => signInWith("apple");
  // Upgrade both buttons to the ID-token flow once their scripts load; until
  // then (or if they never do) the OAuth redirect above still works.
  qsMountGoogle(container);
  qsMountApple(container);
}

function show(el)   { el.classList.remove("hidden"); }
function hide(el)   { el.classList.add("hidden"); }
function setNotice(el, kind, text) {
  el.className = `notice ${kind}`;
  el.textContent = text;
  show(el);
}
