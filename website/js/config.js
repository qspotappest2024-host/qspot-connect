/**
 * QSpot Website Configuration
 *
 * SETUP INSTRUCTIONS:
 * 1. Replace MAPTILER_API_KEY with your free MapTiler key from https://cloud.maptiler.com/
 * 2. The Supabase anon key below is read-only (enforced by RLS policies)
 * 3. For production, consider moving these to environment variables in your CI/CD
 */

const QSPOT_CONFIG = {
    // Supabase (read-only anon access — RLS enforces spots_select_anon_live_only)
    SUPABASE_URL: 'https://zlfrcgznovxcinsxzclt.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsZnJjZ3pub3Z4Y2luc3h6Y2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5Mjg2NDksImV4cCI6MjA2NDUwNDY0OX0.i_nowvP_RrRuSm4orRpVpTYW-PrU9HEbTcdLxUKDvew',

    // MapTiler — Sign up free at https://cloud.maptiler.com/ (100k map loads/month free)
    // TODO: Replace with your MapTiler API key
    MAPTILER_API_KEY: 'YOUR_MAPTILER_API_KEY_HERE',

    // ── LOCAL TESTING WITHOUT A MAPTILER KEY ──────────────────────────────
    // Set USE_FREE_TILES to true to use OpenFreeMap vector tiles instead.
    // OpenFreeMap is free with no API key required and uses the same
    // MapLibre GL JS engine, so your markers/popups work identically.
    // Switch back to false (and add your real MapTiler key above) for
    // production — OpenFreeMap has no SLA and shouldn't be used for live traffic.
    USE_FREE_TILES: true,   // ← set false once you have a MapTiler key

    // Map defaults
    MAP_DEFAULT_CENTER: [-98.5795, 39.8283], // Center of US
    MAP_DEFAULT_ZOOM: 4,
    MAP_STYLE: 'streets-v2', // MapTiler style name

    // App store links (update when published)
    APP_STORE_URL: '#',
    PLAY_STORE_URL: '#',

    // Contact
    CONTACT_EMAIL: 'support@qspot.app',
};
