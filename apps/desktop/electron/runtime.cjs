'use strict';
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { existsSync } = require('node:fs');
const path = require('node:path');

const MAX_RESULT_BYTES = 2_000_000;
const SESSION_PATH = /^\/v1\/sessions\/[a-f0-9]{32}\/turns$/;
const ARTIFACT_LIST_PATH = /^\/v1\/artifacts\?session_id=[a-f0-9]{32}$/;
const ARTIFACT_DOWNLOAD_PATH = /^\/v1\/artifacts\/[a-f0-9]{32}\?session_id=[a-f0-9]{32}$/;

function validateRequest(route, options = {}) {
  if (typeof route !== 'string' || route.length > 100) throw new Error('Unsupported BOLT API route');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid request');
  const allowed = new Map([
    ['/health', ['GET']],
    ['/v1/catalog', ['GET']],
    ['/v1/data-sources', ['GET']],
    ['/v1/sessions', ['GET', 'POST']],
    ['/v1/chat', ['POST']],
    ['/v1/presentations', ['POST']],
    ['/v1/charts', ['POST']],
    ['/v1/preferences', ['GET', 'POST']],
    ['/v1/memory/search', ['POST']],
    ['/v1/memory/erase', ['POST']],
    ['/v1/collections', ['GET', 'POST']],
    ['/v1/collection-items', ['POST']],
    ['/v1/artifacts/all', ['GET']],
  ]);
  const method = options.method === undefined ? 'GET' : options.method;
  if (method !== 'GET' && method !== 'POST') throw new Error('Unsupported API method');
  if (SESSION_PATH.test(route) || ARTIFACT_LIST_PATH.test(route) || ARTIFACT_DOWNLOAD_PATH.test(route)) {
    if (method !== 'GET') throw new Error('Scoped resource is read-only');
  } else if (!allowed.has(route) || !allowed.get(route).includes(method)) {
    throw new Error('Unsupported BOLT API route or method');
  }
  let body;
  if (method === 'POST' && options.body !== undefined) {
    if (typeof options.body !== 'string' || options.body.length > 4000) throw new Error('Invalid request payload');
    let data;
    try { data = JSON.parse(options.body); } catch { throw new Error('Invalid JSON payload'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid request fields');
    const keys = Object.keys(data).sort().join(',');
    const isId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
    const validators = {
      '/v1/sessions': () => keys === '',
      '/v1/chat': () => keys === 'question,session_id' && isId(data.session_id)
        && typeof data.question === 'string' && data.question.length >= 1 && data.question.length <= 2000,
      '/v1/presentations': () => keys === 'session_id,title' && isId(data.session_id)
        && typeof data.title === 'string' && data.title.trim().length >= 1 && data.title.length <= 140,
      '/v1/charts': () => keys === 'query_id,session_id' && isId(data.session_id)
        && typeof data.query_id === 'string' && data.query_id.length >= 1 && data.query_id.length <= 200,
      '/v1/preferences': () => keys === 'key,value' && typeof data.key === 'string'
        && data.key.length >= 1 && data.key.length <= 100,
      '/v1/memory/search': () => keys === 'limit,query' && typeof data.query === 'string'
        && data.query.length >= 1 && data.query.length <= 200
        && Number.isInteger(data.limit) && data.limit >= 1 && data.limit <= 20,
      '/v1/memory/erase': () => keys === 'confirmation'
        && data.confirmation === 'ERASE MY BOLT MEMORY',
      '/v1/collections': () => keys === 'name' && typeof data.name === 'string'
        && data.name.trim().length >= 1 && data.name.length <= 100,
      '/v1/collection-items': () => keys === 'collection_id,result_ref,session_id,title'
        && isId(data.collection_id) && isId(data.session_id)
        && typeof data.result_ref === 'string' && data.result_ref.length >= 1 && data.result_ref.length <= 200
        && typeof data.title === 'string' && data.title.trim().length >= 1 && data.title.length <= 140,
    };
    if (!validators[route] || !validators[route]()) throw new Error('Invalid request fields');
    body = JSON.stringify(data);
  } else if (options.body !== undefined) {
    throw new Error('Body is not permitted for this request');
  } else if (method === 'POST' && route !== '/v1/sessions') {
    throw new Error('Request body is required');
  }
  return { method, body };
}

function backendCommand({ isPackaged, resourcesPath, appPath, userData, pythonCommand, platform = process.platform }) {
  const db = path.join(userData, 'bolt_sessions.sqlite3');
  if (isPackaged) {
    const binary = path.join(resourcesPath, 'backend', platform === 'win32' ? 'bolt-service.exe' : 'bolt-service');
    return { command: binary, args: ['--db', db], cwd: path.dirname(binary), bundled: true };
  }
  const cwd = path.resolve(appPath, '..', '..', 'services', 'api');
  return { command: pythonCommand || (platform === 'win32' ? 'python' : 'python3'),
    args: ['-m', 'bolt.desktop_service', '--db', db], cwd, bundled: false };
}

function readyPort(child, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let done = false;
    let buffer = '';
    const finish = (error, port) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdout.removeListener('data', onData);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      if (error) reject(error); else resolve(port);
    };
    const onError = () => finish(new Error('Unable to launch the local BOLT API'));
    const onExit = () => finish(new Error('BOLT local API terminated before becoming ready'));
    const onData = chunk => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 8192) return finish(new Error('Invalid BOLT API startup response'));
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        const match = /^BOLT_READY ([0-9]{1,5})$/.exec(line);
        if (!match) continue;
        const port = Number(match[1]);
        if (port < 1 || port > 65535) return finish(new Error('Invalid BOLT API port'));
        return finish(null, port);
      }
    };
    const timer = setTimeout(() => finish(new Error('BOLT API startup timed out')), timeoutMs);
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function startBackend(spec, { spawnProcess = spawn, fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  if (!existsSync(spec.cwd) || (spec.bundled && !existsSync(spec.command))) {
    throw new Error('BOLT Python backend is missing. Rebuild the desktop backend before packaging.');
  }
  const token = randomBytes(32).toString('hex');
  const child = spawnProcess(spec.command, spec.args, {
    cwd: spec.cwd, env: { ...process.env, BOLT_API_TOKEN: token, BOLT_DESKTOP_CHILD: '1', PYTHONUNBUFFERED: '1' },
    shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stderr?.on('data', () => { /* Consume logs; never surface environment or secrets to renderer. */ });
  let stopped = false;
  const stop = () => { if (!stopped) { stopped = true; child.kill(); } };
  try {
    const port = await readyPort(child, timeoutMs);
    const baseUrl = `http://127.0.0.1:${port}`;
    const doRequest = async (route, opts) => {
      const {method, body} = validateRequest(route, opts);
      const response = await fetchImpl(baseUrl + route, {
        method, body, headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
        signal: AbortSignal.timeout(15000),
      });
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > MAX_RESULT_BYTES) throw new Error('BOLT API response too large');
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_RESULT_BYTES) throw new Error('BOLT API response too large');
      return {ok: response.ok, status: response.status, data: raw ? JSON.parse(raw) : null};
    };
    let health;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('BOLT API stopped before ready');
      try {
        health = await doRequest('/health');
        if (health.ok && health.data.mode === 'synthetic') break;
      } catch { /* Socket may not yet be accepting connections. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!health?.ok || health.data.mode !== 'synthetic') throw new Error('BOLT API did not respond to authenticated health check');
    return { port, request: doRequest, stop, child };
  } catch (error) {
    stop();
    throw error;
  }
}

module.exports = { validateRequest, backendCommand, readyPort, startBackend };
