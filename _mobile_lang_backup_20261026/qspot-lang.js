/**
 * QSpot website — French / English layer for the static pages.
 *
 * One page per purpose: the English text is the markup itself (what a crawler,
 * or a reader with JS off, sees) and each page carries its French beside it in
 * a dictionary. Elements marked data-i18n="key" take dict[key] when the page is
 * French. Same attribute scheme as web/qspot.js, so every page works alike.
 *
 *   data-i18n="key"                           -> innerHTML = dict[key]
 *   data-i18n-attr="aria-label:key;title:key" -> attributes
 *   data-langbar                              -> the "Français | English" switcher
 *   dict.doc_title                            -> document.title
 *
 * innerHTML is deliberate: the dictionaries are each page's own constant text
 * (some entries carry <strong>/<a>), never user or server data.
 *
 * Language choice: ?lang=fr|en (also remembered) -> remembered choice ->
 * browser language. Stored under the same key as the Premium pages
 * (qspot_lang), so one choice follows the visitor across the whole site.
 * localStorage is a per-viewer convenience only and every access is guarded.
 *
 * Also swaps the "QSpot Marketplace" logo for the French "QSpot Marché"
 * lockup wherever it appears, so a page needs no per-image markup.
 */
(function () {
    'use strict';

    var KEY = 'qspot_lang';
    var LOGO_EN = 'qspot-marketplace-horizontal.svg';
    var LOGO_FR = 'qspot-marche-fr-horizontal.svg';
    // Intrinsic widths of the two lockups at the same height (1710 vs 1320).
    var LOGO_RATIO = 1320 / 1710;

    function ok(v) { return v === 'fr' || v === 'en'; }

    function detect() {
        var l = null;
        try { l = new URLSearchParams(location.search).get('lang'); } catch (e) { l = null; }
        if (ok(l)) {
            try { localStorage.setItem(KEY, l); } catch (e) { /* private mode */ }
            return l;
        }
        try { l = localStorage.getItem(KEY); } catch (e) { l = null; }
        if (ok(l)) return l;
        return (navigator.language || '').toLowerCase().indexOf('fr') === 0 ? 'fr' : 'en';
    }


    // French for the chrome every marketing page shares (menu, footer, quick-links
    // bar, app-badges). A page's own dictionary overrides these keys.
    var COMMON_FR = {
        skip: "Passer au contenu", skip_map: "Passer à la carte",
        nav_home: "Accueil", nav_how: "Comment ça marche", nav_map: "Carte en direct",
        nav_about: "À propos", nav_app: "Obtenir l'application",
        toggle_dark: "Basculer le mode sombre", toggle_menu: "Ouvrir ou fermer le menu",
        ft_tag: "Achetez et vendez votre place dans la file grâce à un échange équitable, un pour un. Bientôt sur iOS et Android.",
        ft_product: "Produit", ft_company: "Entreprise", ft_legal: "Juridique",
        ft_why: "Pourquoi QSpot Marché", ft_pay: "Paiements et sécurité",
        ft_contact: "Nous joindre", ft_privacy: "Politique de confidentialité",
        ft_terms: "Conditions d'utilisation", ft_delete: "Supprimer votre compte", ft_patents: "Brevets",
        href_privacy: "web/confidentialite.html", href_terms: "web/conditions.html",
        ft_copy: '&copy; 2026 QSpot Technologies Inc. Tous droits réservés. &middot; <a class="footer-patent" href="web/patents.html#fr" hreflang="fr">Brevet américain en instance</a>',
        ft_ig: "QSpot Marché sur Instagram", ft_x: "QSpot Marché sur X", ft_yt: "QSpot Technologies sur YouTube",
        ft_follow: "Suivez-nous",
        mb_label: "Liens rapides QSpot", mb_text: "Achetez et vendez votre place dans la file", mb_close: "Fermer la bannière",
        soon_tag: "Bientôt", soon_note: "Bientôt sur iOS et Android",
        badge_appstore_l: "Télécharger dans l'", badge_play_l: "Disponible sur",
        app_store_aria: "QSpot dans l'App Store (bientôt)", play_store_aria: "QSpot sur Google Play (bientôt)",
        app_icon_alt: "Icône de l'application QSpot",
        stripe_aria: "Propulsé par Stripe (ouvre stripe.com)", stripe_powered: "Propulsé par"
    };

    var lang = detect();

    function swapLogos() {
        if (lang !== 'fr') return;
        var imgs = document.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
            var img = imgs[i];
            var src = img.getAttribute('src') || '';
            if (src.indexOf(LOGO_EN) === -1) continue;
            img.setAttribute('src', src.replace(LOGO_EN, LOGO_FR));
            img.setAttribute('alt', 'QSpot Marché');
            var w = parseFloat(img.getAttribute('width'));
            if (w) img.setAttribute('width', String(Math.round(w * LOGO_RATIO)));
        }
    }

    function langbar() {
        var bars = document.querySelectorAll('[data-langbar]');
        for (var i = 0; i < bars.length; i++) {
            var u = new URL(location.href);
            var here = function (code) {
                u.searchParams.set('lang', code);
                return u.pathname + u.search + u.hash;
            };
            bars[i].innerHTML = lang === 'fr'
                ? '<span class="cur" lang="fr">Français</span> &nbsp;|&nbsp; <a href="' + here('en') + '" lang="en">English</a>'
                : '<a href="' + here('fr') + '" lang="fr">Français</a> &nbsp;|&nbsp; <span class="cur" lang="en">English</span>';
        }
    }

    /** Applies a page's French dictionary. No-op in English apart from the switcher. */
    function apply(page) {
        document.documentElement.lang = lang === 'fr' ? 'fr-CA' : 'en';
        if (lang === 'fr') {
            var dict = {}, key;
            for (key in COMMON_FR) dict[key] = COMMON_FR[key];
            for (key in (page || {})) dict[key] = page[key];
            var els = document.querySelectorAll('[data-i18n]');
            for (var i = 0; i < els.length; i++) {
                var v = dict[els[i].getAttribute('data-i18n')];
                if (v != null) els[i].innerHTML = v;
            }
            var attrs = document.querySelectorAll('[data-i18n-attr]');
            for (var j = 0; j < attrs.length; j++) {
                var pairs = attrs[j].getAttribute('data-i18n-attr').split(';');
                for (var k = 0; k < pairs.length; k++) {
                    var kv = pairs[k].split(':');
                    var av = dict[kv[1]];
                    if (kv[0] && av != null) attrs[j].setAttribute(kv[0], av);
                }
            }
            if (dict.doc_title) document.title = dict.doc_title;
            document.body.classList.add('lang-fr');
        }
        swapLogos();
        langbar();
    }

    window.QSLang = {
        lang: lang,
        isFr: lang === 'fr',
        locale: lang === 'fr' ? 'fr-CA' : 'en-CA',
        apply: apply,
        /** pick(en, fr): the string for the current language. */
        pick: function (en, fr) { return lang === 'fr' ? fr : en; }
    };
})();
