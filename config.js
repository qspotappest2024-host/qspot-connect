// QSpot web app configuration
// ─────────────────────────────────────────────────────────────────────────────
// All three values are PUBLIC by design:
//  • SUPABASE_URL / SUPABASE_ANON_KEY — same values as secrets.properties
//    (the anon key is the public client key; RLS protects the data).
//  • STRIPE_PUBLISHABLE_KEY — pk_... key; publishable keys are safe to embed.
//    Use pk_test_... while testing, pk_live_... for production.
// Never put sk_..., whsec_..., or the service-role key in this repo.

window.QSPOT_CONFIG = {
  SUPABASE_URL: "https://zlfrcgznovxcinsxzclt.supabase.co",
  SUPABASE_ANON_KEY: "PASTE_YOUR_SUPABASE_ANON_KEY_HERE",
  STRIPE_PUBLISHABLE_KEY: "PASTE_YOUR_STRIPE_PUBLISHABLE_KEY_HERE",
};
