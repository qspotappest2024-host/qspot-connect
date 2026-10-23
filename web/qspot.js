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
  },
  fr: {
    login_title: "Connectez-vous pour continuer",
    login_sub: "Utilisez le même compte que dans l'application QSpot.",
    login_google: "Continuer avec Google",
    login_apple: " Continuer avec Apple",
    login_hme: "Inscrit dans l'application avec Apple et « Masquer mon adresse courriel »? Utilisez <strong>Continuer avec Apple</strong> ici pour que vos comptes correspondent.",
    login_patent: "Brevet américain en instance",
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
      <button class="oauth" id="login-google">${c("login_google")}</button>
      <button class="oauth apple" id="login-apple">${c("login_apple")}</button>
      <p style="margin-top:12px;font-size:0.8rem;">${c("login_hme")}</p>
      <p style="margin-top:14px;font-size:0.75rem;text-align:center;">
        <a href="/web/patents.html" style="text-decoration:underline;">${c("login_patent")}</a>
      </p>
    </div>`;
  container.querySelector("#login-google").onclick = () => signInWith("google");
  container.querySelector("#login-apple").onclick  = () => signInWith("apple");
}

function show(el)   { el.classList.remove("hidden"); }
function hide(el)   { el.classList.add("hidden"); }
function setNotice(el, kind, text) {
  el.className = `notice ${kind}`;
  el.textContent = text;
  show(el);
}
