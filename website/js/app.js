/**
 * QSpot Website — Shared JavaScript
 * Navigation, mobile menu, scroll effects, utilities
 */

document.addEventListener('DOMContentLoaded', () => {
    initNavbar();
    initMobileMenu();
    setActiveNavLink();
    wireAppStoreLinks();
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
