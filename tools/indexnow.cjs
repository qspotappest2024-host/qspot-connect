#!/usr/bin/env node
/**
 * IndexNow ping, run by deploy.yml after the live deployment is verified.
 *
 * Tells Bing (which also feeds DuckDuckGo, Yahoo and Ecosia), Yandex, Seznam, Naver and
 * other IndexNow engines which pages changed, so they re-crawl them within minutes
 * instead of whenever they next pass by. Google does not use IndexNow.
 *
 * Which URLs: only pages touched by this push (from the push payload's commit file lists),
 * limited to URLs listed in the sitemap. A change to the sitemap, the French build or the
 * language script submits every sitemap URL. A manual run (workflow_dispatch) submits all.
 *
 * The key is the 32-hex file website/<key>.txt, served at https://www.qspotmarketplace.com/<key>.txt.
 * Never fails the deploy: problems are logged as warnings.
 *
 * Usage: COMMITS_JSON='${{ toJson(github.event.commits) }}' node tools/indexnow.cjs _site
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SITE = process.argv[2] || '_site';
const HOST = 'www.qspotmarketplace.com';
const BASE = 'https://' + HOST;

function warn(msg) { console.log('::warning::IndexNow: ' + msg); }

async function main() {
  const keyFile = fs.readdirSync(SITE).find((f) => /^[a-f0-9]{32}\.txt$/.test(f));
  if (!keyFile) return warn('no <32-hex>.txt key file in the site root; skipping.');
  const key = keyFile.slice(0, -4);

  const sitemap = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
  const all = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

  let commits = [];
  try { commits = JSON.parse(process.env.COMMITS_JSON || '[]') || []; } catch (e) { commits = []; }
  const files = new Set();
  for (const c of commits) for (const k of ['added', 'modified']) for (const f of (c[k] || [])) files.add(f);

  const SUBMIT_ALL = ['website/sitemap.xml', 'tools/build-i18n.cjs', 'website/js/qspot-lang.js'];
  let urls;
  if (!commits.length || SUBMIT_ALL.some((f) => files.has(f))) {
    urls = all;
  } else {
    const wanted = new Set();
    for (const f of files) {
      let m;
      if ((m = f.match(/^website\/([^/]+\.html)$/))) {
        const p = m[1] === 'index.html' ? '/' : '/' + m[1];
        wanted.add(BASE + p);
        wanted.add(BASE + (p === '/' ? '/fr/' : '/fr' + p));
      } else if ((m = f.match(/^web\/([^/]+\.html)$/))) {
        wanted.add(BASE + '/web/' + m[1]);
      }
    }
    urls = all.filter((u) => wanted.has(u));
  }
  if (!urls.length) { console.log('IndexNow: no indexable pages changed in this push; nothing to submit.'); return; }

  const body = { host: HOST, key, keyLocation: `${BASE}/${key}.txt`, urlList: urls };
  console.log(`IndexNow: submitting ${urls.length} URL(s):\n  ` + urls.join('\n  '));
  if (process.env.DRY_RUN) { console.log('(dry run: not sent)'); return; }
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    // 200 = accepted, 202 = accepted (key validation pending). Anything else is worth a look.
    if (res.status === 200 || res.status === 202) console.log(`✓ IndexNow accepted (HTTP ${res.status})`);
    else warn(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  } catch (e) {
    warn('request failed: ' + e.message);
  }
}
main();
