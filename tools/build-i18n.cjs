#!/usr/bin/env node
/**
 * Build step: real French pages + hreflang + FAQ structured data.
 *
 * Runs in .github/workflows/deploy.yml after "Assemble site", against _site/.
 *
 * The English markup stays the single source of truth. Each page already carries its
 * French beside it (the QSLang.apply({...}) dictionary + COMMON_FR in js/qspot-lang.js).
 * This script applies that French at build time and writes a static copy under /fr/,
 * so Google can index French pages instead of only seeing the English text that the
 * ?lang=fr switch rewrites in the browser.
 *
 * For every page in PAGES:
 *   _site/<page>     English: + hreflang alternates (+ FAQPage JSON-LD if it has .faq-item)
 *   _site/fr/<page>  French:  translated text/attributes/title, lang="fr-CA",
 *                    data-qs-lang="fr", French logos, French canonical/og tags,
 *                    hreflang alternates, root-absolute asset URLs, links to the French
 *                    counterparts, /web/ links with ?lang=fr (+ FAQPage JSON-LD in French)
 *
 * Usage: NODE_PATH=<dir with linkedom> node tools/build-i18n.cjs _site
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseHTML } = require('linkedom');

const SITE = process.argv[2] || '_site';
const BASE = 'https://www.qspotmarketplace.com';
const PAGES = [
  'index.html', 'about.html', 'map.html',
  'concerts-and-events.html', 'restaurants.html', 'amusement-parks.html', 'product-drops.html',
];
// Pages whose FAQ gets FAQPage structured data (marked up once, on the homepage only).
const FAQ_SCHEMA_PAGES = new Set(['index.html']);
const LOGO_EN = 'qspot-marketplace-horizontal.svg', LOGO_FR = 'qspot-marche-fr-horizontal.svg';
const LOGO_RATIO = 1320 / 1710;
const SQUARE_EN = 'qspot-marketplace-square.svg', SQUARE_FR = 'qspot-marche-fr-square.svg';

const enPath = (p) => (p === 'index.html' ? '/' : '/' + p);
const frPath = (p) => (p === 'index.html' ? '/fr/' : '/fr/' + p);

function evalObject(literal, where) {
  try { return vm.runInNewContext('(' + literal + ')', {}, { timeout: 1000 }); }
  catch (e) { throw new Error(`Could not read the French dictionary in ${where}: ${e.message}`); }
}

const langJs = fs.readFileSync(path.join(SITE, 'js/qspot-lang.js'), 'utf8');
const commonMatch = langJs.match(/var COMMON_FR = (\{[\s\S]*?\n {4}\});/);
if (!commonMatch) throw new Error('COMMON_FR not found in js/qspot-lang.js');
const COMMON_FR = evalObject(commonMatch[1], 'js/qspot-lang.js');

function pageDict(html, page) {
  const m = html.match(/QSLang\.apply\((\{[\s\S]*?\})\);/);
  return m ? evalObject(m[1], page) : {};
}

function addAlternates(document, page) {
  const head = document.head;
  head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((l) => l.remove());
  const canonical = head.querySelector('link[rel="canonical"]');
  const links = [['en-CA', BASE + enPath(page)], ['fr-CA', BASE + frPath(page)], ['x-default', BASE + enPath(page)]];
  let after = canonical;
  for (const [lang, href] of links) {
    const l = document.createElement('link');
    l.setAttribute('rel', 'alternate'); l.setAttribute('hreflang', lang); l.setAttribute('href', href);
    if (after) { after.after(l); after = l; } else head.appendChild(l);
  }
}

function addFaqSchema(document, lang) {
  const items = [...document.querySelectorAll('.faq-item')];
  if (!items.length) return 0;
  const clean = (s) => s.replace(/\s+/g, ' ').trim();
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: lang,
    mainEntity: items.map((d) => ({
      '@type': 'Question',
      name: clean(d.querySelector('summary').textContent),
      acceptedAnswer: { '@type': 'Answer', text: clean(d.querySelector('.faq-a').textContent) },
    })),
  };
  document.querySelectorAll('script[data-faq-schema]').forEach((s) => s.remove());
  const s = document.createElement('script');
  s.setAttribute('type', 'application/ld+json');
  s.setAttribute('data-faq-schema', '');
  s.textContent = '\n' + JSON.stringify(data, null, 2) + '\n';
  document.head.appendChild(s);
  return items.length;
}

function setMeta(document, selector, attr, value) {
  if (value == null) return;
  const el = document.head.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

const strip = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

function rewriteUrl(v) {
  if (!v || /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(v)) return v;   // absolute, root-relative or fragment
  const cut = v.search(/[?#]/);
  const p = cut === -1 ? v : v.slice(0, cut);
  const rest = cut === -1 ? '' : v.slice(cut);
  if (PAGES.includes(p)) return frPath(p) + rest;
  if (/^web\/[^?#]+\.html$/.test(p)) {
    // The /web/ pages pick their language from ?lang= (and remember it).
    const q = rest.startsWith('?') ? rest.replace(/^\?/, '?lang=fr&') : '?lang=fr' + rest;
    return '/' + p + q;
  }
  return '/' + v;
}

function buildFrench(html, page) {
  const { document } = parseHTML(html);
  const dict = Object.assign({}, COMMON_FR, pageDict(html, page));

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = dict[el.getAttribute('data-i18n')];
    if (v != null) el.innerHTML = v;
  });
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.getAttribute('data-i18n-attr').split(';').forEach((pair) => {
      const [attr, key] = pair.split(':');
      if (attr && dict[key] != null) el.setAttribute(attr, dict[key]);
    });
  });

  const html_ = document.documentElement;
  html_.setAttribute('lang', 'fr-CA');
  html_.setAttribute('data-qs-lang', 'fr');
  document.body.classList.add('lang-fr');
  if (dict.doc_title) document.title = dict.doc_title;

  document.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (src.includes(SQUARE_EN)) {
      img.setAttribute('src', src.replace(SQUARE_EN, SQUARE_FR)); img.setAttribute('alt', 'QSpot Marché');
    } else if (src.includes(LOGO_EN)) {
      img.setAttribute('src', src.replace(LOGO_EN, LOGO_FR)); img.setAttribute('alt', 'QSpot Marché');
      const w = parseFloat(img.getAttribute('width'));
      if (w) img.setAttribute('width', String(Math.round(w * LOGO_RATIO)));
    }
  });

  const url = BASE + frPath(page);
  setMeta(document, 'link[rel="canonical"]', 'href', url);
  setMeta(document, 'meta[property="og:url"]', 'content', url);
  const title = dict.doc_title ? strip(dict.doc_title) : null;
  const desc = dict.og_desc || dict.meta_desc;
  setMeta(document, 'meta[property="og:title"]', 'content', title);
  setMeta(document, 'meta[name="twitter:title"]', 'content', title);
  setMeta(document, 'meta[property="og:description"]', 'content', desc && strip(desc));
  setMeta(document, 'meta[name="twitter:description"]', 'content', desc && strip(desc));
  setMeta(document, 'meta[property="og:site_name"]', 'content', 'QSpot Marché');
  // French share image (QSpot Marché logo) and alt text.
  for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    const el = document.head.querySelector(sel);
    if (el) el.setAttribute('content', el.getAttribute('content').replace('og-image-marketplace.png', 'og-image-marketplace-fr.png'));
  }
  setMeta(document, 'meta[property="og:image:alt"]', 'content', 'QSpot Marché : achetez et vendez votre place dans la file, un échange équitable, un pour un');
  const ogType = document.head.querySelector('meta[property="og:type"]');
  if (ogType && !document.head.querySelector('meta[property="og:locale"]')) {
    const a = document.createElement('meta'); a.setAttribute('property', 'og:locale'); a.setAttribute('content', 'fr_CA');
    const b = document.createElement('meta'); b.setAttribute('property', 'og:locale:alternate'); b.setAttribute('content', 'en_CA');
    ogType.after(a); a.after(b);
  }

  document.querySelectorAll('[href], [src]').forEach((el) => {
    for (const attr of ['href', 'src']) {
      if (el.hasAttribute(attr)) el.setAttribute(attr, rewriteUrl(el.getAttribute(attr)));
    }
  });

  addAlternates(document, page);
  const faq = FAQ_SCHEMA_PAGES.has(page) ? addFaqSchema(document, 'fr-CA') : 0;
  return { out: document.toString(), faq };
}

function buildEnglish(html, page) {
  const { document } = parseHTML(html);
  addAlternates(document, page);
  const faq = FAQ_SCHEMA_PAGES.has(page) ? addFaqSchema(document, 'en-CA') : 0;
  return { out: document.toString(), faq };
}

fs.mkdirSync(path.join(SITE, 'fr'), { recursive: true });
for (const page of PAGES) {
  const file = path.join(SITE, page);
  if (!fs.existsSync(file)) throw new Error(`${page} is listed in PAGES but missing from ${SITE}`);
  const src = fs.readFileSync(file, 'utf8');
  const fr = buildFrench(src, page);
  const en = buildEnglish(src, page);
  fs.writeFileSync(path.join(SITE, 'fr', page), fr.out);
  fs.writeFileSync(file, en.out);
  console.log(`✓ ${page} -> fr/${page}` + (en.faq ? `  (FAQPage: ${en.faq} EN / ${fr.faq} FR)` : ''));
}
