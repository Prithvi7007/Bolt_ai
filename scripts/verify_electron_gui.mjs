#!/usr/bin/env node
/**
 * Real packaged-Electron GUI smoke test using the Node 22 WebSocket/CDP APIs.
 * No browser automation dependency, LLM, external service, or real company data.
 * The Chrome DevTools endpoint is bound to 127.0.0.1 for this test process only.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { constants, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const backendFlag = process.argv.indexOf('--backend');
if (backendFlag < 0 || !process.argv[backendFlag + 1]) {
  throw new Error('Usage: node scripts/verify_electron_gui.mjs --backend <packaged service binary>');
}
const backend = path.resolve(process.argv[backendFlag + 1]);
const packageDir = path.dirname(path.dirname(path.dirname(backend)));
assert.ok(existsSync(backend), 'Bundled backend executable is missing');
assert.ok(path.basename(path.dirname(backend)) === 'backend', 'Expected Electron resources/backend sidecar');

const candidates = process.platform === 'win32'
  ? ['BOLT AI.exe']
  : readdirSync(packageDir).filter(name => /^bolt[- ]/i.test(name) && !name.includes('.'));
const appBinary = candidates.map(name => path.join(packageDir, name))
  .find(file => existsSync(file) && statSync(file).isFile());
assert.ok(appBinary, 'No packaged BOLT Electron executable found in ' + packageDir);

async function freeLocalPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function eventually(action, label, timeoutMs = 75000) {
  let last;
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) { last = error; }
    await wait(350);
  }
  throw new Error('Timed out: ' + label + (last ? '; ' + last.message : ''));
}

function connect(url) {
  if (typeof WebSocket !== 'function') throw new Error('This test requires Node 22 WebSocket support');
  const socket = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message || 'CDP command failed'));
    else entry.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('CDP socket closed'));
    }
    pending.clear();
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once: true});
    socket.addEventListener('error', () => reject(new Error('CDP connection failed')), {once: true});
  });
  return {
    opened,
    async send(method, params = {}) {
      await opened;
      const req = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(req);
          reject(new Error('CDP command timed out: ' + method));
        }, 12000);
        pending.set(req, {resolve, reject, timer});
        socket.send(JSON.stringify({id: req, method, params}));
      });
    },
    async eval(expression) {
      const result = await this.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
      });
      if (result.exceptionDetails) throw new Error('Renderer JavaScript exception in GUI verification');
      return result.result?.value;
    },
    close() { socket.close(); },
  };
}

async function launch(sandbox) {
  const port = await freeLocalPort();
  const args = [
    '--remote-debugging-port=' + port,
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
  ];
  const environment = {
    ...process.env,
    APPDATA: sandbox,
    LOCALAPPDATA: path.join(sandbox, 'local'),
    XDG_CONFIG_HOME: sandbox,
    BOLT_DEV: '0',
  };
  let command = appBinary;
  let argv = args;
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    const detected = spawnSync('which', ['xvfb-run'], {encoding: 'utf8'});
    if (detected.status !== 0) throw new Error('Linux GUI verification requires xvfb-run or DISPLAY');
    command = 'xvfb-run';
    argv = ['-a', '--', appBinary, ...args, '--disable-gpu'];
  }
  const child = spawn(command, argv, {
    env: environment, windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2500); });
  child.on('error', error => { stderr = (stderr + ' ' + error.message).slice(-2500); });
  try {
    const target = await eventually(async () => {
      if (child.exitCode !== null) throw new Error('Electron exited early: ' + stderr);
      const response = await fetch('http://127.0.0.1:' + port + '/json/list', {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return null;
      const targets = await response.json();
      return targets.find(item => item.type === 'page'
        && typeof item.webSocketDebuggerUrl === 'string'
        && item.url.startsWith('file://'));
    }, 'packaged Electron window exposed its local test-only CDP endpoint');
    const cdp = connect(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Runtime.enable');
    return {child, cdp};
  } catch (error) {
    await shutdown({child});
    throw error;
  }
}

async function shutdown(running) {
  if (!running) return;
  try { running.cdp?.close(); } catch {}
  const child = running.child;
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true, timeout: 15000,
    });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await wait(600);
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
  await wait(500);
}

async function main() {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'bolt-gui-'));
  let running;
  try {
    running = await launch(sandbox);
    const first = running.cdp;
    await eventually(async () => await first.eval(
      'document.querySelector(".inspector-footer")?.textContent?.includes("Synthetic API online")'
    ), 'first launch authenticated synthetic API is online');
    assert.equal(await first.eval(
      'typeof window.boltApi?.request === "function" && typeof window.require === "undefined"'
    ), true, 'Packaged renderer must use the restricted authenticated IPC bridge');

    await eventually(async () => await first.eval(
      'Boolean(document.querySelector(".session-button.selected"))'
    ), 'initial synthetic conversation is ready');
    const clicked = await first.eval(
      '(() => { const b = [...document.querySelectorAll("button.example")].find(x => x.textContent.includes("2026 revenue by channel")); if (!b) return false; b.click(); return true; })()'
    );
    assert.equal(clicked, true, 'Revenue example must be clickable');
    await eventually(async () => await first.eval(
      'document.querySelectorAll("section.turn.assistant .result-chart").length > 0'
    ), 'revenue question returns a rendered chart');
    assert.equal(await first.eval(
      '/^\\s*SELECT\\b/i.test(document.querySelector("pre.sql code")?.textContent || "")'
    ), true, 'Evidence inspector must show executed SELECT SQL');

    const dataClicked = await first.eval(
      '(() => { const b = [...document.querySelectorAll(".inspector-tabs button")].find(x => x.textContent.trim() === "Data"); if (!b) return false; b.click(); return true; })()'
    );
    assert.equal(dataClicked, true, 'Data inspector tab must be clickable');
    await eventually(async () => await first.eval(
      'document.querySelectorAll(".data-table-wrapper tbody tr").length >= 4'
    ), 'Data inspector must display 4 synthetic channel rows');
    const session = await first.eval(
      'document.querySelector(".session-button.selected")?.textContent?.trim()'
    );
    assert.ok(session?.startsWith('Conversation '), 'New session must appear in sidebar');
    console.log('PASS: packaged Electron window, restricted IPC, revenue chart, SQL and data inspector');
    await shutdown(running);
    running = null;

    running = await launch(sandbox);
    const second = running.cdp;
    await eventually(async () => await second.eval(
      'document.querySelector(".inspector-footer")?.textContent?.includes("Synthetic API online") && document.querySelectorAll("section.turn.assistant .result-chart").length > 0'
    ), 'restarted Electron restores persisted synthetic answer and chart');
    assert.equal(await second.eval(
      'document.querySelector(".session-button.selected")?.textContent?.trim()'
    ), session, 'Restart must restore the same conversation');
    assert.equal(await second.eval(
      '/^\\s*SELECT\\b/i.test(document.querySelector("pre.sql code")?.textContent || "")'
    ), true, 'Restart must restore SQL evidence from persisted conversation');
    console.log('PASS: packaged Electron restart restores conversation, chart and evidence');
  } finally {
    await shutdown(running);
    try { rmSync(sandbox, {recursive: true, force: true, maxRetries: 10, retryDelay: 300}); }
    catch (error) { console.error('Warning: temporary GUI sandbox cleanup failed: ' + error.code); }
  }
}
main().catch(error => {
  console.error('FAIL: packaged Electron GUI smoke test: ' + error.message);
  process.exitCode = 1;
});
