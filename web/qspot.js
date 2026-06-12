// QSpot web — shared helpers (auth + Edge Function calls)
// Requires: config.js loaded first, @supabase/supabase-js v2 UMD loaded from CDN.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.QSPOT_CONFIG;

// supabase-js v2 UMD exposes window.supabase.createClient
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    .select("subscription_status, subscription_interval, premium_until, scheduled_subscription_interval, display_name")
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
  if (!epochMs || epochMs <= 0) return "—";
  return new Date(epochMs).toLocaleDateString("en-CA", {
    year: "numeric", month: "long", day: "numeric",
  });
}

/** Standard login card markup — call inside a container element. */
function renderLoginCard(container) {
  container.innerHTML = `
    <div class="card">
      <h2>Sign in to continue</h2>
      <p>Use the same account you use in the QSpot app.</p>
      <button class="oauth" id="login-google">Continue with Google</button>
      <button class="oauth apple" id="login-apple"> Continue with Apple</button>
      <p style="margin-top:12px;font-size:0.8rem;">
        Signed up in the app with Apple and "Hide My Email"? Use
        <strong>Continue with Apple</strong> here so your accounts match.
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
