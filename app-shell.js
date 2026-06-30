const SHELL_VERSION = 'hms-shell-v5';
const SHELL_ASSETS = [
  './index.html',
  './user.html',
  './admin.html',
  './confirmed.html',
  './styles.css',
  './config.js',
  './courses.js',
  './app-shell.js',
];

let warmed = false;

export function warmAppShell() {
  if (warmed) return;
  warmed = true;
  prefetchShellAssets();
  warmCache();
  registerShellWorker();
}

export function setupPageTransition() {
  document.documentElement.classList.add('page-ready');
  if (sessionStorage.getItem('hms:navigating')) {
    sessionStorage.removeItem('hms:navigating');
    document.documentElement.classList.add('page-arriving');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => document.documentElement.classList.remove('page-arriving'));
    });
  }
}

export function navigateShell(page, base = location.href) {
  const target = new URL(page, base).href;
  if (target === location.href) return;
  sessionStorage.setItem('hms:navigating', '1');
  document.documentElement.classList.add('page-leaving');
  setTimeout(() => { location.href = target; }, prefersReducedMotion() ? 0 : 140);
}

export function replaceShell(page, base = location.href) {
  const target = new URL(page, base).href;
  sessionStorage.setItem('hms:navigating', '1');
  document.documentElement.classList.add('page-leaving');
  setTimeout(() => { location.replace(target); }, prefersReducedMotion() ? 0 : 140);
}

function prefetchShellAssets() {
  if (!document.head) return;
  for (const asset of SHELL_ASSETS) {
    const href = new URL(asset, location.href).href;
    if (href === location.href) continue;
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    link.as = asset.endsWith('.css') ? 'style'
      : asset.endsWith('.js') ? 'script'
      : 'document';
    document.head.append(link);
  }
}

async function warmCache() {
  if (!('caches' in window) || !isHttp()) return;
  try {
    const cache = await caches.open(SHELL_VERSION);
    await Promise.allSettled(SHELL_ASSETS.map(asset => cache.add(new URL(asset, location.href).href)));
  } catch (_) {
    // Cache warming is optional; normal navigation still works.
  }
}

function registerShellWorker() {
  if (!('serviceWorker' in navigator) || !isHttp()) return;
  navigator.serviceWorker.register(new URL('./sw.js', location.href).href).catch(() => {});
}

function isHttp() {
  return location.protocol === 'http:' || location.protocol === 'https:';
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}
