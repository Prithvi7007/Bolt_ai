#!/usr/bin/env node
/**
 * Real packaged-Electron GUI smoke test using the Node 22 WebSocket/CDP APIs.
 * No browser automation dependency, LLM, external service, or real company data.
 * The Chrome DevTools endpoint is bound to 127.0.0.1 for this test process only.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { constants, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
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

// Drive the real Windows Save dialog in this disposable CI desktop only.
function respondToSaveDialog(destination) {
  assert.equal(process.platform,'win32','Native Save-dialog verification is Windows-only');
  const literal = value => "'" + value.replace(/'/g,"''") + "'";
  const keys = destination?.replace(/[+^%~()[\]{}]/g,c => '{' + c + '}');
  const action = destination ? [
    "[System.Windows.Forms.SendKeys]::SendWait('%n')",
    'Start-Sleep -Milliseconds 150',
    "[System.Windows.Forms.SendKeys]::SendWait('^a')",
    '[System.Windows.Forms.SendKeys]::SendWait(' + literal(keys) + ')',
    'Start-Sleep -Milliseconds 150',
    "[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
  ] : ["[System.Windows.Forms.SendKeys]::SendWait('{ESC}')"];
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Windows.Forms',
    '$shell = New-Object -ComObject WScript.Shell',
    '$active = $false',
    'for ($attempt = 0; $attempt -lt 60; $attempt++) {',
    "  if ($shell.AppActivate('Save BOLT analysis')) { $active = $true; break }",
    '  Start-Sleep -Milliseconds 200',
    '}',
    "if (-not $active) { throw 'BOLT Save dialog was not found' }",
    'Start-Sleep -Milliseconds 300',
    ...action,
  ].join('\r\n');
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-STA',
    '-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
    encoding:'utf8',windowsHide:true,timeout:20000,
  });
  assert.equal(result.status,0,'Native Save dialog interaction failed: '+(result.stderr||result.error?.message||''));
}

async function main() {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'bolt-gui-'));
  let running;
  const modelRequests = [];
  const modelServer = createHttpServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; if (body.length > 64000) request.destroy(); });
    request.on('end', () => {
      try {
        assert.equal(request.method, 'POST');
        assert.equal(request.url, '/v1/chat/completions');
        const payload = JSON.parse(body);
        modelRequests.push(JSON.parse(payload.messages[1].content));
        const encoded = JSON.stringify({choices:[{message:{content:JSON.stringify({kind:'sum',target:'attendance'})}}],
          usage:{prompt_tokens:20,completion_tokens:10}});
        response.writeHead(200, {'Content-Type':'application/json','Content-Length':Buffer.byteLength(encoded)});
        response.end(encoded);
      } catch {
        response.writeHead(400); response.end('{}');
      }
    });
  });
  await new Promise((resolve,reject) => {
    modelServer.once('error',reject);
    modelServer.listen(0,'127.0.0.1',resolve);
  });
  const modelPort = modelServer.address().port;

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
    // Exercise the local-only Data Lab with a generated CSV, never company data.
    const openedLab = await first.eval(
      '(() => { const b = [...document.querySelectorAll("button.workspace-button")].find(x => x.textContent.includes("Data Lab")); if (!b) return false; b.click(); return true; })()'
    );
    assert.equal(openedLab, true, 'Data Lab navigation must work');
    await eventually(async () => await first.eval(
      'getComputedStyle(document.querySelector("main.data-lab")).display !== "none"'
    ), 'Data Lab screen is displayed');
    const imported = await first.eval(
      '(() => { const input = document.querySelector("#bolt-csv-import"); if (!input) return false; const csv = ["month,attendance", "2026-01,100", "2026-02,120", "2026-03,130"].join(String.fromCharCode(10)); const f = new File([csv], "synthetic-lab.csv", {type:"text/csv"}); const d = new DataTransfer(); d.items.add(f); input.files = d.files; input.dispatchEvent(new Event("change", {bubbles:true})); return true; })()'
    );
    assert.equal(imported, true, 'CSV file input must accept local data');
    await eventually(async () => await first.eval(
      'document.querySelector(".lab-result-header h2")?.textContent?.includes("synthetic-lab.csv") && document.querySelector("#bolt-target")?.value === "attendance"'
    ), 'Data Lab profiles synthetic CSV and identifies attendance as a candidate target');
    const approved = await first.eval(
      '(() => { document.querySelector(".lab-target-control button")?.click(); return document.querySelector("#bolt-target")?.value; })()'
    );
    assert.equal(approved, 'attendance', 'Target selection must be available');
    await eventually(async () => await first.eval(
      'document.querySelector(".lab-approved")?.textContent?.includes("Target approved: attendance")'
    ), 'Data Lab target approval appears in the UI');
    const analyzed = await first.eval(
      '(() => { const b = document.querySelector(".lab-analyze-button"); if (!b) return false; b.click(); return true; })()'
    );
    assert.equal(analyzed, true, 'Approved target can run a local analysis');
    await eventually(async () => await first.eval(
      'document.querySelector(".lab-analysis-provenance")?.textContent?.includes("3 rows") && document.querySelector(".lab-analysis-kpis")?.textContent?.includes("116.67")'
    ), 'Local analysis calculates the real synthetic CSV mean rather than demo data');
    assert.equal(await first.eval(
      'document.querySelector(".lab-series-dates")?.textContent?.includes("2026-01")'
    ), true, 'Local analysis renders observed monthly date series');
    assert.equal(await first.eval(
      'document.querySelector(".lab-timeline-coverage")?.textContent?.includes("3 of 3 valid target rows") && document.querySelector(".lab-timeline-coverage")?.textContent?.includes("0 missing or invalid date rows")'
    ), true, 'Local timeline must disclose actual date coverage');
    const localQuestionSent = await first.eval(
      '(() => { const b = [...document.querySelectorAll(".lab-ask-examples button")].find(x => x.textContent.includes("total attendance")); if (!b) return false; b.click(); return true; })()'
    );
    assert.equal(localQuestionSent, true, 'The real-CSV question prompt must be clickable');
    await eventually(async () => await first.eval(
      'document.querySelector(".lab-ask-answer .lab-ask-primary")?.textContent?.includes("350") && document.querySelector(".lab-ask-proof")?.textContent?.includes("Sum")'
    ), 'Packaged Data Lab answers total attendance from actual local CSV with formula evidence');
    assert.equal(await first.eval(
      'document.querySelector(".lab-ask-evidence")?.textContent?.includes("3 numeric target rows")'
    ), true, 'Real CSV question contains an evidence-backed row count');
    // The report generator receives only the calculated answer. Save through the real native dialog.
    assert.equal(await first.eval(
      'window.boltApi.saveDataAnswer({format:"html",path:"forbidden"}).then(()=>false,()=>true)'
    ),true,'Malformed export payloads must fail before opening a dialog');
    if (process.platform === 'win32') {
      const htmlExport = path.join(sandbox,'synthetic-answer.html');
      assert.equal(await first.eval(
        '(() => { const b=document.querySelector(".lab-ask-turn:last-child .lab-ask-save-csv"); return !!b && !b.disabled; })()'
      ),true,'Calculated CSV answers expose local export actions');
      await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-save-report").click()');
      respondToSaveDialog(htmlExport);
      await eventually(async()=>existsSync(htmlExport)&&await first.eval(
        'document.querySelector(".lab-ask-turn:last-child .lab-ask-export-status")?.textContent?.includes("Analysis report saved")'
      ),'HTML analysis report is saved through the native dialog');
      const reportHtml = readFileSync(htmlExport,'utf8');
      for(const value of ['350','synthetic-lab.csv','3 numeric target rows','Sum of all valid numeric attendance','not a full extract']) {
        assert.ok(reportHtml.includes(value),'Exported report retains '+value);
      }
      assert.equal(reportHtml.includes('2026-01'),false,'The export excludes raw CSV source rows');
      const csvExport = path.join(sandbox,'synthetic-answer.csv');
      await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-save-csv").click()');
      respondToSaveDialog(csvExport);
      await eventually(async()=>existsSync(csvExport)&&await first.eval(
        'document.querySelector(".lab-ask-turn:last-child .lab-ask-export-status")?.textContent?.includes("Analysis CSV saved")'
      ),'CSV analysis results are saved through the native dialog');
      const reportCsv = readFileSync(csvExport,'utf8');
      assert.ok(reportCsv.includes('"Section","Label","Value","Detail"'));
      assert.ok(reportCsv.includes('350')&&reportCsv.includes('3 numeric target rows'));
      await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-save-report").click()');
      respondToSaveDialog();
      await eventually(async()=>await first.eval(
        'document.querySelector(".lab-ask-turn:last-child .lab-ask-export-status")?.textContent === "Save cancelled."'
      ),'Cancelling the native dialog is reported without claiming a save');
      assert.equal(modelRequests.length,0,'Export must not contact the model');
      console.log('PASS: packaged CSV answer exports HTML and CSV through native Save dialogs; cancellation works');
    }
    const configured = await first.eval('window.boltApi.modelSettings("save",'+JSON.stringify({
      endpoint:'http://127.0.0.1:'+modelPort+'/v1',model:'synthetic-planner',auth_mode:'none',token:'',timeout_seconds:10,
    })+')');
    assert.equal(configured.configured,true,'Packaged personal model configuration must work');
    assert.equal(await first.eval(
      '(() => { const input=document.querySelector(".lab-ai-choice input"); if(!input||input.disabled)return false; input.click(); document.querySelector(".lab-ask-composer textarea").focus(); return input.checked; })()'
    ),true,'CSV AI planning must require an explicit opt-in');
    await first.send('Input.insertText',{text:'Give me a quick snapshot of attendance'});
    await eventually(async()=>await first.eval(
      '!document.querySelector(".lab-ask-composer button")?.disabled'
    ),'CSV AI question is ready to submit');
    await first.eval('document.querySelector(".lab-ask-composer button").click()');
    await eventually(async()=>await first.eval(
      'document.querySelector(".lab-ask-turn:last-child .lab-ask-planning")?.textContent?.includes("AI interpretation: sum") && document.querySelector(".lab-ask-turn:last-child .lab-ask-primary")?.textContent?.includes("350")'
    ),'AI schema interpretation computes the real local CSV total');
    await eventually(async()=>await first.eval(
      'document.querySelector(".lab-ask-turn:last-child .lab-data-workflow-status")?.textContent?.includes("LangGraph") && document.querySelector(".lab-ask-turn:last-child .lab-data-workflow-status strong")?.textContent === "Completed"'
    ),'Packaged LangGraph pauses for local calculation and resumes to completion');
    assert.equal(modelRequests.length,1,'Graph resume must not repeat the model planning call');
    assert.deepEqual(Object.keys(modelRequests[0]).sort(),['columns','question','target']);
    assert.deepEqual(modelRequests[0].columns,[{name:'month',type:'date'},{name:'attendance',type:'numeric'}]);
    const transmitted = JSON.stringify(modelRequests[0]);
    for(const value of ['synthetic-lab.csv','2026-01','100','120','130','preview']) {
      assert.equal(transmitted.includes(value),false,'CSV source values must not reach the model');
    }
    await first.eval('window.boltApi.modelSettings("disconnect")');
    console.log('PASS: packaged LangGraph pause/resume uses one schema-only model call and computes the actual local total');
    await first.eval(
      '([...document.querySelectorAll("button.workspace-button")].find(x => x.textContent.includes("Analyst")))?.click()'
    );
    console.log('PASS: packaged Electron Data Lab CSV import, local profile, and target approval');
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
    modelServer.closeAllConnections();
    await new Promise(resolve=>modelServer.close(resolve));
    await shutdown(running);
    try { rmSync(sandbox, {recursive: true, force: true, maxRetries: 10, retryDelay: 300}); }
    catch (error) { console.error('Warning: temporary GUI sandbox cleanup failed: ' + error.code); }
  }
}
main().catch(error => {
  console.error('FAIL: packaged Electron GUI smoke test: ' + error.message);
  process.exitCode = 1;
});
