#!/usr/bin/env node
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith('--')) || 'http://localhost:5173/admin.html';
const port = Number(readFlag('--port') || 9223);
const waitMs = Number(readFlag('--wait') || 3500);
const failOnError = args.includes('--fail-on-error');
const loginPath = readFlag('--login');
const loginIndex = Number(readFlag('--login-index') || 1);

function readFlag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('Chrome executable not found. Set CHROME_PATH to chrome.exe.');
  return found;
}

function getJson(endpoint, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(endpoint, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${endpoint} returned ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(new Error(`Invalid JSON from ${endpoint}: ${err.message}`)); }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timed out fetching ${endpoint}`));
    });
    req.on('error', reject);
  });
}

async function waitForDebugPort() {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const started = Date.now();
  let lastErr;
  while (Date.now() - started < 10000) {
    try { return await getJson(endpoint, 1000); }
    catch (err) { lastErr = err; await sleep(250); }
  }
  throw lastErr || new Error(`Chrome debug port ${port} did not open`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readCredentials(filePath, index = 1) {
  const full = path.resolve(process.cwd(), filePath);
  const lines = fs.readFileSync(full, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const emailIndexes = lines.map((line, i) => /@/.test(line) ? i : -1).filter(i => i >= 0);
  const userIndex = emailIndexes[Math.max(0, index - 1)] ?? emailIndexes[0] ?? 0;
  const username = lines[userIndex];
  const password = lines[userIndex + 1] || lines.find((line, idx) => idx !== userIndex && !/@/.test(line));
  if (!username || !password) throw new Error(`Could not parse username/password from ${filePath}`);
  return { username, password };
}

function loginExpression(creds) {
  return `(() => {
    const ident = ${JSON.stringify(creds.username)};
    const password = ${JSON.stringify(creds.password)};
    const lid = document.querySelector('#lid');
    const pw = document.querySelector('#pw');
    if (!lid || !pw) return 'no-login-form';
    const input = value => new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value });
    lid.value = ident;
    lid.dispatchEvent(input(ident));
    pw.value = password;
    pw.dispatchEvent(input(password));
    const buttons = [...document.querySelectorAll('button')];
    const signIn = buttons.find(b => /sign in|logg inn/i.test(b.textContent || '')) || buttons[0];
    if (!signIn) return 'no-signin-button';
    signIn.click();
    return 'submitted';
  })()`;
}

async function ensureChrome() {
  try {
    const version = await getJson(`http://127.0.0.1:${port}/json/version`, 1000);
    return { spawned: null, version };
  } catch (err) {
    const profile = path.join(os.tmpdir(), `hms-codex-chrome-${port}`);
    fs.mkdirSync(profile, { recursive: true });
    const spawned = spawn(chromePath(), [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ], { stdio: 'ignore' });
    spawned.unref();
    const version = await waitForDebugPort();
    return { spawned, version };
  }
}

async function cdpSession(target) {
  if (typeof WebSocket !== 'function') {
    throw new Error('This script needs Node 22+ with global WebSocket support.');
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];

  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      events.push(msg);
    }
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  const send = (method, params = {}) => new Promise(resolve => {
    const callId = ++id;
    pending.set(callId, resolve);
    ws.send(JSON.stringify({ id: callId, method, params }));
  });

  return { ws, send, events };
}

function summarizeEvent(ev) {
  if (ev.method === 'Runtime.exceptionThrown') {
    const d = ev.params.exceptionDetails || {};
    return { type: 'exception', text: d.text || d.exception?.description || d.exception?.value || 'Runtime exception' };
  }
  if (ev.method === 'Runtime.consoleAPICalled') {
    return {
      type: ev.params.type,
      text: (ev.params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 500),
    };
  }
  if (ev.method === 'Log.entryAdded') {
    return { type: ev.params.entry.level, text: ev.params.entry.text };
  }
  if (ev.method === 'Network.loadingFailed') {
    return { type: 'network', text: `${ev.params.errorText}: ${ev.params.requestId}` };
  }
  if (ev.method === 'Network.responseReceived') {
    const r = ev.params.response;
    return { type: 'http', text: `${r.status} ${r.url}` };
  }
  return { type: ev.method, text: JSON.stringify(ev.params).slice(0, 500) };
}

(async () => {
  const { spawned, version } = await ensureChrome();
  let ws;
  try {
    const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
    const target = targets.find(t => t.type === 'page') || targets[0];
    if (!target) throw new Error(`No Chrome page target on port ${port}`);

    const session = await cdpSession(target);
    ws = session.ws;
    const { send, events } = session;

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Network.enable');
    await send('Page.navigate', { url });
    await sleep(waitMs);
    let loginResult = null;
    if (loginPath) {
      const creds = readCredentials(loginPath, loginIndex);
      const login = await send('Runtime.evaluate', { expression: loginExpression(creds), returnByValue: true });
      loginResult = login.result?.result?.value || 'unknown';
      await sleep(Math.max(waitMs, 6500));
    }

    const expression = `JSON.stringify({
      url: location.href,
      title: document.title,
      body: document.body ? document.body.innerText.slice(0, 1200) : '',
      readyState: document.readyState
    })`;
    const evaluated = await send('Runtime.evaluate', { expression, returnByValue: true });
    const pageState = JSON.parse(evaluated.result?.result?.value || '{}');

    const issues = events
      .filter(ev => {
        if (ev.method === 'Runtime.exceptionThrown') return true;
        if (ev.method === 'Network.loadingFailed') {
          return ev.params.errorText !== 'net::ERR_ABORTED';
        }
        if (ev.method === 'Log.entryAdded') {
          if (/^Failed to load resource:/i.test(ev.params.entry.text || '')) return false;
          return ['error', 'warning'].includes(ev.params.entry.level);
        }
        if (ev.method === 'Runtime.consoleAPICalled') {
          const text = (ev.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
          if (/^Failed to load resource:/i.test(text)) return false;
          return ['error', 'warning'].includes(ev.params.type);
        }
        if (ev.method === 'Network.responseReceived') {
          const r = ev.params.response;
          if (/\/favicon\.ico(?:$|\?)/i.test(r.url)) return false;
          return r.status >= 400;
        }
        return false;
      })
      .map(summarizeEvent)
      .slice(0, 50);

    const summary = {
      ok: !issues.some(i => ['exception', 'error', 'http', 'network'].includes(i.type)),
      target: url,
      chromePort: port,
      login: loginPath ? { result: loginResult, credentialIndex: loginIndex } : undefined,
      page: pageState,
      issues,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (failOnError && !summary.ok) process.exitCode = 1;
  } finally {
    if (ws) ws.close();
    if (spawned) {
      try {
        const browser = await cdpSession({ webSocketDebuggerUrl: version.webSocketDebuggerUrl });
        await browser.send('Browser.close');
        browser.ws.close();
      } catch (err) {
        spawned.kill();
      }
    }
  }
})().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
