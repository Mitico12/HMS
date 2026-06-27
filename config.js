// config.js — shared Supabase client + helpers for both admin.html and user.html.
// Imported as an ES module: <script type="module"> import { db, ... } from './config.js'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── FILL THESE IN ───────────────────────────────────────────
// Project settings → API. The anon key is safe to ship client-side;
// Row Level Security in schema.sql is what actually protects the data.
const SUPABASE_URL = 'https://vtiobzmsalsvwocvlotm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_BfCizLoxWkUk2L9sUXzv9w_M5TdA3uD';
// ─────────────────────────────────────────────────────────────

export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// A throwaway auth client used by admins when creating accounts.
// It prevents the admin's own browser session from being replaced by the new user session.
export function newAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// Return the signed-in user's profile (with role), or null.
export async function currentProfile() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from('profiles').select('*').eq('id', user.id).single();
  return data;
}

// Guard a page: ensure someone is signed in, optionally that they're admin.
// Redirects to the login screen handled inside each page if not.
export async function requireSession({ admin = false } = {}) {
  const profile = await currentProfile();
  if (!profile) return { ok: false, reason: 'no-session' };
  if (admin && !['admin', 'super_admin'].includes(profile.role)) return { ok: false, reason: 'not-admin', profile };
  return { ok: true, profile };
}

// Tiny DOM helper: el('div', { class: 'x' }, [children]) or el('div', 'text').
export function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  if (typeof props === 'string') { node.textContent = props; return node; }
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) {
    if (kid == null) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');
}

export function themeToggleButton() {
  initTheme();
  const btn = el('button', { class: 'iconbtn theme-toggle', title: 'Toggle dark mode', onclick: toggleTheme }, themeIcon());
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    btn.textContent = themeIcon();
  }
  return btn;
}

function themeIcon() {
  return document.documentElement.dataset.theme === 'dark' ? '☀' : '◐';
}

// Format an ISO timestamp as a short local string.
export function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Lightweight toast.
export function toast(msg, kind = 'ok') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host', class: 'toast-host' });
    document.body.appendChild(host);
  }
  const t = el('div', { class: `toast toast-${kind}` }, msg);
  host.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}
