/**
 * QSpot Website — Shared JavaScript
 * Navigation, mobile menu, scroll effects, utilities
 */

// Mark JS as active (enables scroll-reveal styles) + apply theme ASAP to avoid flash
(function () {
    document.documentElement.classList.add('js');
    const stored = localStorage.getItem('qspot-theme');
    if (stored === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else if (stored === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    }
    // If nothing stored, CSS @media prefers-color-scheme handles it automatically
})();

document.addEventListener('DOMContentLoaded', () => {
    initNavbar();
    initMobileMenu();
    setActiveNavLink();
    wireAppStoreLinks();
    initDarkModeToggle();
    initScrollReveal();
    initSwapDemo();
});

/* --- Navbar scroll effect --- */
function initNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    const onScroll = () => {
        navbar.classList.toggle('scrolled', window.scrollY > 10);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
}

/* --- Mobile hamburger menu --- */
function initMobileMenu() {
    const toggle = document.querySelector('.nav-toggle');
    const links = document.querySelector('.nav-links');
    if (!toggle || !links) return;

    const toggleMenu = () => {
        links.classList.toggle('open');
        toggle.setAttribute('aria-expanded', links.classList.contains('open'));
    };

    toggle.addEventListener('click', toggleMenu);

    // Keyboard support: Enter and Space should toggle
    toggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleMenu();
        }
    });

    // Close menu when a link is clicked
    links.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            links.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
        });
    });

    // Close menu on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && links.classList.contains('open')) {
            links.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.focus();
        }
    });
}

/* --- Highlight current page in nav --- */
function setActiveNavLink() {
    const path = window.location.pathname;
    const currentPage = path.split('/').pop() || 'index.html';

    document.querySelectorAll('.nav-links a').forEach(link => {
        // Remove any hardcoded active class first to avoid duplicates
        link.classList.remove('active');

        const href = link.getAttribute('href');
        // Skip CTA buttons and anchor-only links
        if (!href || href.startsWith('#') || link.classList.contains('nav-cta')) return;

        const linkPage = href.split('#')[0]; // strip hash
        if (linkPage === currentPage || (currentPage === '' && linkPage === 'index.html')) {
            link.classList.add('active');
        }
    });
}

/* --- Wire up app store links from config --- */
function wireAppStoreLinks() {
    if (typeof QSPOT_CONFIG === 'undefined') return;

    const appStoreLink = document.getElementById('app-store-link');
    const playStoreLink = document.getElementById('play-store-link');

    if (appStoreLink && QSPOT_CONFIG.APP_STORE_URL) {
        appStoreLink.href = QSPOT_CONFIG.APP_STORE_URL;
    }
    if (playStoreLink && QSPOT_CONFIG.PLAY_STORE_URL) {
        playStoreLink.href = QSPOT_CONFIG.PLAY_STORE_URL;
    }
}

/* --- Dark mode toggle --- */
function initDarkModeToggle() {
    const btn = document.getElementById('dark-mode-toggle');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme');
        // Determine effective current theme (manual override or OS preference)
        const osDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const isDark = current === 'dark' || (current !== 'light' && osDark);

        if (isDark) {
            html.setAttribute('data-theme', 'light');
            localStorage.setItem('qspot-theme', 'light');
            btn.setAttribute('aria-label', 'Switch to dark mode');
        } else {
            html.setAttribute('data-theme', 'dark');
            localStorage.setItem('qspot-theme', 'dark');
            btn.setAttribute('aria-label', 'Switch to light mode');
        }
    });

    // Update aria-label on load based on current state
    const osDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const stored = localStorage.getItem('qspot-theme');
    const isDark = stored === 'dark' || (stored !== 'light' && osDark);
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
}

/* --- Scroll reveal on view (progressive enhancement) --- */
function initScrollReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
        els.forEach(el => el.classList.add('in-view'));
        return;
    }

    const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
                obs.unobserve(entry.target);
            }
        });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });

    els.forEach(el => io.observe(el));
}

/* --- Hero one-for-one demo: cycles 1-for-1 -> 2-for-2 -> 3-for-3 --- */
function initSwapDemo() {
    const demo = document.querySelector('.ofo-demo');
    if (!demo) return;

    const slots = Array.from(demo.querySelectorAll('.ofo-slot'));
    const badge = demo.querySelector('.ofo-badge');
    const caption = demo.querySelector('.ofo-caption-text');
    if (!slots.length || !badge || !caption) return;

    const MAX_SWAPS = Math.min(3, slots.length);
    const STAGGER = 130;   // ms between each spot in a multi-swap
    const T_SWAP = 1000;   // sellers step out / buyers step in
    const T_SETTLE = 3000; // buyers become part of the line
    const T_RESET = 4200;  // invisible loop reset (after every transition has landed)
    const T_NEXT = 4500;   // next count starts

    const captionFor = (n) => n === 1
        ? 'Seller <b>steps out</b> \u00b7 buyer <b>steps in</b>'
        : n + ' sellers <b>step out</b> \u00b7 ' + n + ' buyers <b>step in</b>';

    let timers = [];
    let count = 1;
    let running = false;
    let inView = true;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const after = (fn, ms) => timers.push(window.setTimeout(fn, ms));
    const clearTimers = () => { timers.forEach(window.clearTimeout); timers = []; };

    function resetSlots() {
        demo.classList.add('no-anim');
        slots.forEach((slot) => {
            slot.classList.remove('is-listed', 'is-swapped', 'is-settled');
            slot.style.removeProperty('--ofo-delay');
        });
        void demo.offsetWidth; // flush the change before transitions come back
        demo.classList.remove('no-anim');
    }

    function label(n) {
        badge.textContent = n + '-for-' + n;
        caption.innerHTML = captionFor(n);
    }

    function runPhase(n) {
        timers = []; // every timer from the previous phase has already fired
        count = n;
        label(n);
        badge.classList.add('is-bump');
        after(() => badge.classList.remove('is-bump'), 420);

        const active = slots.slice(0, n);
        active.forEach((slot, i) => {
            slot.style.setProperty('--ofo-delay', (i * STAGGER) + 'ms');
            slot.classList.add('is-listed');
        });

        after(() => active.forEach(s => s.classList.add('is-swapped')), T_SWAP);
        after(() => active.forEach(s => s.classList.add('is-settled')), T_SETTLE);
        after(resetSlots, T_RESET);
        after(() => runPhase(n < MAX_SWAPS ? n + 1 : 1), T_NEXT);
    }

    function start() {
        if (running || !inView || document.hidden || reduceMotion.matches) return;
        running = true;
        runPhase(count);
    }

    function stop() {
        if (!running) return;
        running = false;
        clearTimers();
        resetSlots();
    }

    function applyMotionPreference() {
        if (reduceMotion.matches) {
            stop();
            label(1);
            slots[0].classList.add('is-listed'); // static diagram, no movement
        } else {
            slots.forEach(s => s.classList.remove('is-listed'));
            count = 1;
            start();
        }
    }

    // Only animate while the demo is on screen and the tab is visible.
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                inView = entry.isIntersecting;
                if (inView) start(); else stop();
            });
        }, { threshold: 0.15 });
        io.observe(demo);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stop(); else start();
    });

    if (typeof reduceMotion.addEventListener === 'function') {
        reduceMotion.addEventListener('change', applyMotionPreference);
    }

    applyMotionPreference();
}

/* --- Utility: Format currency --- */
function formatPrice(amount, currency = 'USD') {
    if (amount == null || isNaN(amount)) return '$0';
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency,
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }).format(amount);
    } catch (e) {
        // Fallback for invalid currency codes
        return `$${Number(amount).toFixed(2)}`;
    }
}

/* --- Utility: Star rating display --- */
function renderStars(rating) {
    if (!rating || rating < 0) rating = 0;
    if (rating > 5) rating = 5;
    const full = Math.floor(rating);
    const half = rating % 1 >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return '\u2605'.repeat(full) + (half ? '\u00BD' : '') + '\u2606'.repeat(empty);
}

/* --- Utility: Time ago --- */
function timeAgo(epochMs) {
    const seconds = Math.floor((Date.now() - epochMs) / 1000);
    if (seconds < 0) return 'Just now';
    const intervals = [
        { label: 'year', seconds: 31536000 },
        { label: 'month', seconds: 2592000 },
        { label: 'week', seconds: 604800 },
        { label: 'day', seconds: 86400 },
        { label: 'hour', seconds: 3600 },
        { label: 'minute', seconds: 60 },
    ];
    for (const { label, seconds: s } of intervals) {
        const count = Math.floor(seconds / s);
        if (count >= 1) return `${count} ${label}${count > 1 ? 's' : ''} ago`;
    }
    return 'Just now';
}
