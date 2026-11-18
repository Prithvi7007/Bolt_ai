#!/usr/bin/env node
/**
 * Real packaged-Electron GUI smoke test using the Node 22 WebSocket/CDP APIs.
 * No browser automation dependency, LLM, external service, or real company data.
 * The Chrome DevTools endpoint is bound to 127.0.0.1 for this test process only.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { constants, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

// Drive real Windows file dialogs in this disposable CI desktop only.
// UI Automation targets the dialog controls directly, independent of keyboard focus.
function respondToFileDialog(destination, title) {
  assert.equal(process.platform,'win32','Native file-dialog verification is Windows-only');
  const literal=value=>"'"+value.replace(/'/g,"''")+"'";
  const script=[
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -AssemblyName UIAutomationTypes',
    '$root = [System.Windows.Automation.AutomationElement]::RootElement',
    '$descendants = [System.Windows.Automation.TreeScope]::Descendants',
    '$nameProperty = [System.Windows.Automation.AutomationElement]::NameProperty',
    '$typeProperty = [System.Windows.Automation.AutomationElement]::ControlTypeProperty',
    '$dialogCondition = [System.Windows.Automation.PropertyCondition]::new($nameProperty,'+literal(title)+')',
    '$dialog = $null',
    'for ($attempt = 0; $attempt -lt 60; $attempt++) {',
    '  $dialog = $root.FindFirst([System.Windows.Automation.TreeScope]::Children,$dialogCondition)',
    '  if ($null -ne $dialog) { break }',
    '  Start-Sleep -Milliseconds 200',
    '}',
    "if ($null -eq $dialog) { throw 'BOLT file dialog was not found' }",
    'function Describe-Dialog {',
    '  $controls = $dialog.FindAll($descendants,[System.Windows.Automation.Condition]::TrueCondition)',
    '  $items = foreach ($control in $controls) {',
    '    if ($control.Current.IsEnabled -and -not $control.Current.IsOffscreen) {',
    '      $control.Current.ControlType.ProgrammaticName + \": \" + $control.Current.Name + \" [\" + $control.Current.AutomationId + \"]\"',
    '    }',
    '  }',
    '  ($items | Select-Object -First 30) -join \"; \"',
    '}',
    ...(destination?[
      '$editCondition = [System.Windows.Automation.PropertyCondition]::new($typeProperty,[System.Windows.Automation.ControlType]::Edit)',
      '$filename = $null',
      'for ($attempt = 0; $attempt -lt 30; $attempt++) {',
      '  $edits = $dialog.FindAll($descendants,$editCondition)',
      '  foreach ($edit in $edits) {',
      '    if ($edit.Current.IsEnabled -and $edit.Current.Name -match \"^File name:?$\" -and $edit.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty)) { $filename = $edit; break }',
      '  }',
      '  if ($null -ne $filename) { break }',
      '  Start-Sleep -Milliseconds 100',
      '}',
      'if ($null -eq $filename) { throw (\"BOLT filename control not found: \" + (Describe-Dialog)) }',
      '$value = $filename.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)',
      '$value.SetValue('+literal(destination)+')',
      'if ($value.Current.Value -ne '+literal(destination)+') { throw \"BOLT filename control did not retain the selected path\" }',
    ]:[]),
    '$buttonName = '+literal(destination?(title==='Open BOLT analysis'?'Open':'Save'):'Cancel'),
    '$buttonCondition = [System.Windows.Automation.AndCondition]::new(',
    '  [System.Windows.Automation.PropertyCondition]::new($typeProperty,[System.Windows.Automation.ControlType]::Button),',
    '  [System.Windows.Automation.PropertyCondition]::new($nameProperty,$buttonName))',
    '$button = $dialog.FindFirst($descendants,$buttonCondition)',
    'if ($null -eq $button -or -not $button.Current.IsEnabled) { throw (\"BOLT file-dialog button unavailable: \" + (Describe-Dialog)) }',
    '$invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)',
    '$invoke.Invoke()',
    'for ($attempt = 0; $attempt -lt 50; $attempt++) {',
    '  Start-Sleep -Milliseconds 100',
    '  if ($null -eq $root.FindFirst([System.Windows.Automation.TreeScope]::Children,$dialogCondition)) { exit 0 }',
    '}',
    'throw (\"BOLT file dialog did not close after \" + $buttonName + \": \" + (Describe-Dialog))',
  ].join('\r\n');
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-STA',
    '-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
    encoding:'utf8',windowsHide:true,timeout:25000,
  });
  assert.equal(result.status,0,'Native file dialog interaction failed: '+(result.stderr||result.stdout||result.error?.message||''));
}

function respondToSaveDialog(destination){return respondToFileDialog(destination,'Save BOLT analysis');}

async function main() {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'bolt-gui-'));
  let running;
  const snapshotPath=path.join(sandbox,'synthetic-analysis.bolt');
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
      const pptxExport = path.join(sandbox,'synthetic-answer.pptx');
      await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-save-pptx").click()');
      respondToSaveDialog(pptxExport);
      await eventually(async()=>existsSync(pptxExport)&&await first.eval(
        'document.querySelector(".lab-ask-turn:last-child .lab-ask-export-status")?.textContent?.includes("PowerPoint saved")'
      ),'Editable local CSV presentation is saved through the native dialog');
      const inspectScript = [
        'import json, sys, zipfile, xml.etree.ElementTree as ET',
        'with zipfile.ZipFile(sys.argv[1]) as deck:',
        '    slides = sorted(n for n in deck.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml"))',
        '    roots = [ET.fromstring(deck.read(n)) for n in slides]',
        '    text = "".join("".join(root.itertext()) for root in roots)',
        '    print(json.dumps({"slides":len(slides),"text":text,"editable":all(any(node.tag.endswith("}sp") for node in root.iter()) for root in roots)}))',
      ].join('\n');
      const inspected = spawnSync('python',['-c',inspectScript,pptxExport],{encoding:'utf8',windowsHide:true,timeout:10000});
      assert.equal(inspected.status,0,'The exported PPTX must be a readable Open XML package');
      const deck = JSON.parse(inspected.stdout);
      assert.ok(deck.slides>=3&&deck.slides<=40&&deck.editable,'PPTX contains editable text slides');
      for(const value of ['350','synthetic-lab.csv','3 numeric target rows','Sum of all valid numeric attendance']) {
        assert.ok(deck.text.includes(value),'PowerPoint retains '+value);
      }
      assert.equal(deck.text.includes('Query ID:'),false,'Local slides must not invent query evidence');
      await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-save-pptx").click()');
      respondToSaveDialog();
      await eventually(async()=>await first.eval(
        'document.querySelector(".lab-ask-turn:last-child .lab-ask-export-status")?.textContent === "Save cancelled."'
      ),'Cancelling the native dialog is reported without claiming a save');
      assert.equal(modelRequests.length,0,'Export must not contact the model');
      console.log('PASS: packaged CSV answer exports HTML, CSV and editable PowerPoint through native Save dialogs; cancellation works');
    }
    await first.eval('document.querySelector(".lab-ask-composer textarea").focus()');
    await first.send('Input.insertText',{text:'Show the trend of attendance over time'});
    await eventually(async()=>await first.eval(
      '!document.querySelector(".lab-ask-composer button")?.disabled'
    ),'The observed-date question is ready');
    await first.eval('document.querySelector(".lab-ask-composer button").click()');
    await eventually(async()=>await first.eval(
      'document.querySelectorAll(".lab-ask-turn:last-child .lab-answer-chart circle").length === 3'
    ),'Actual CSV date aggregates render as a line chart');
    const chartTips=await first.eval(
      '[...document.querySelectorAll(".lab-ask-turn:last-child .lab-answer-chart circle title")].map(x=>x.textContent)'
    );
    for(const value of ['100','120','130'])assert.ok(chartTips.some(t=>t.includes(': '+value+' ·')),'Chart uses the actual '+value+' aggregate');
    await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-answer-chart summary").click()');
    assert.equal(await first.eval(
      'document.querySelectorAll(".lab-ask-turn:last-child .lab-chart-table-scroll tbody tr").length'
    ),3,'The chart exposes all underlying aggregate values');
    if(process.platform==='win32'){
      const svgExport=path.join(sandbox,'synthetic-trend.svg');
      await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-save-chart").click()');
      respondToSaveDialog(svgExport);
      await eventually(async()=>existsSync(svgExport)&&await first.eval(
        'document.querySelector(".lab-ask-turn:last-child .lab-ask-export-status")?.textContent === "Chart saved."'
      ),'SVG chart saves through the native dialog');
      const svg=readFileSync(svgExport,'utf8');
      assert.ok(svg.includes('<polyline')&&svg.includes('synthetic-lab.csv')&&svg.includes('3 numeric target rows'));
      for(const value of ['100','120','130'])assert.ok(svg.includes(': '+value+' ·'),'Saved SVG retains the '+value+' aggregate');
      assert.equal(/<script|<image|NaN|Infinity/.test(svg),false,'The saved chart has inert finite geometry');
      const xmlCheck=spawnSync('python',['-c','import sys, xml.etree.ElementTree as ET; root=ET.parse(sys.argv[1]).getroot(); assert root.tag.endswith("}svg")',svgExport],
        {encoding:'utf8',windowsHide:true,timeout:10000});
      assert.equal(xmlCheck.status,0,'The saved chart is valid SVG XML');
      const chartReport=path.join(sandbox,'synthetic-trend.html');
      await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-save-report").click()');
      respondToSaveDialog(chartReport);
      await eventually(async()=>existsSync(chartReport)&&await first.eval(
        'document.querySelector(".lab-ask-turn:last-child .lab-ask-export-status")?.textContent === "Analysis report saved."'
      ),'The HTML report saves an embedded calculated chart');
      const chartHtml=readFileSync(chartReport,'utf8');
      assert.ok(chartHtml.includes('<svg')&&chartHtml.includes('Full chart data')&&chartHtml.includes('130'));
      const chartDeck=path.join(sandbox,'synthetic-trend.pptx');
      await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-save-pptx").click()');
      respondToSaveDialog(chartDeck);
      await eventually(async()=>existsSync(chartDeck)&&await first.eval(
        'document.querySelector(".lab-ask-turn:last-child .lab-ask-export-status")?.textContent === "PowerPoint saved."'
      ),'Charted answers save editable PowerPoint shapes and complete plotted values');
      const chartInspect=[
        'import json, sys, zipfile, xml.etree.ElementTree as ET',
        'ns={"p":"http://schemas.openxmlformats.org/presentationml/2006/main","a":"http://schemas.openxmlformats.org/drawingml/2006/main"}',
        'with zipfile.ZipFile(sys.argv[1]) as deck:',
        '    roots=[ET.fromstring(deck.read(n)) for n in deck.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")]',
        '    shapes=[s for root in roots for s in root.findall(".//p:sp",ns)]',
        '    names=[s.find("p:nvSpPr/p:cNvPr",ns).attrib["name"] for s in shapes]',
        '    markers=[s for s in shapes if s.find("p:nvSpPr/p:cNvPr",ns).attrib["name"].startswith("Data marker ")]',
        '    ys=[int(s.find("p:spPr/a:xfrm/a:off",ns).attrib["y"]) for s in markers]',
        '    xml=[ET.fromstring(deck.read(n)) for n in deck.namelist() if n.endswith((".xml",".rels"))]',
        '    print(json.dumps({"text":"".join("".join(root.itertext()) for root in roots),"markers":len(markers),"segments":sum(n.startswith("Data segment ") for n in names),"ys":ys,"external":any(node.attrib.get("TargetMode")=="External" for root in xml for node in root.iter()),"media":any(n.startswith("ppt/media/") for n in deck.namelist())}))',
      ].join('\n');
      const parsedChart=spawnSync('python',['-c',chartInspect,chartDeck],{encoding:'utf8',windowsHide:true,timeout:10000});
      assert.equal(parsedChart.status,0,'The charted PPTX is a valid editable Open XML package');
      const exportedChart=JSON.parse(parsedChart.stdout);
      assert.equal(exportedChart.markers,3);assert.equal(exportedChart.segments,2);
      assert.ok(exportedChart.ys[0]>exportedChart.ys[1]&&exportedChart.ys[1]>exportedChart.ys[2],'Actual increasing values produce increasing plotted heights');
      assert.equal(exportedChart.external,false);assert.equal(exportedChart.media,false);
      for(const value of ['Full chart data','2026-01: 100.0','2026-02: 120.0','2026-03: 130.0','equal spacing','synthetic-lab.csv','3 numeric target rows']){
        assert.ok(exportedChart.text.includes(value),'PowerPoint chart retains '+value);
      }
      console.log('PASS: packaged CSV chart uses actual aggregates, saves SVG/HTML and editable PowerPoint shapes with full chart data');
    }
    if(process.platform==='win32'){
      assert.equal(await first.eval('window.boltApi.openDataAnalysis({path:"forbidden"}).then(()=>false,()=>true)'),true,'Saved-file IPC cannot receive renderer paths');
      const beforeOpen=await first.eval('document.querySelectorAll(".lab-ask-turn").length');
      await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-save-snapshot").click()');
      respondToSaveDialog(snapshotPath);
      await eventually(async()=>existsSync(snapshotPath)&&await first.eval(
        'document.querySelector(".lab-ask-turn:last-child .lab-ask-export-status")?.textContent === "Analysis snapshot saved."'
      ),'A calculated chart saves as a local BOLT snapshot through the native dialog');
      const saved=JSON.parse(readFileSync(snapshotPath,'utf8'));
      assert.equal(saved.kind,'bolt.analysis.snapshot');assert.equal(saved.version,1);
      assert.equal(saved.sourceName,'synthetic-lab.csv');assert.equal(saved.target,'attendance');
      assert.deepEqual(saved.result.chart.points.map(p=>p.value),[100,120,130]);
      assert.deepEqual(Object.keys(saved).sort(),['interpretation','kind','question','result','savedAt','sourceName','target','version']);
      assert.equal(Object.hasOwn(saved.result,'planning'),false);
      assert.equal(Object.hasOwn(saved.result,'rows'),false);
      await first.eval('document.querySelector(".lab-open-analysis").click()');
      respondToFileDialog(snapshotPath,'Open BOLT analysis');
      await eventually(async()=>await first.eval(
        'document.querySelector(".lab-saved-analysis")?.textContent?.includes("not recalculated") && document.querySelectorAll(".lab-saved-analysis .lab-answer-chart circle").length === 3'
      ),'The saved chart reopens with an explicit snapshot label');
      assert.equal(await first.eval('document.querySelectorAll(".lab-ask-turn").length'),beforeOpen,'Opening a snapshot leaves live question history intact');
      assert.equal(await first.eval('document.querySelectorAll(".lab-saved-analysis .lab-ask-exports,.lab-saved-analysis .lab-ask-composer,.lab-saved-analysis .lab-data-workflow").length'),0,'Saved contents cannot act as a live question or fresh-result export');
      const malformed=path.join(sandbox,'malformed-analysis.bolt');
      writeFileSync(malformed,'{"kind":"not-a-bolt-snapshot"}');
      await first.eval('document.querySelector(".lab-open-analysis").click()');
      respondToFileDialog(malformed,'Open BOLT analysis');
      await eventually(async()=>await first.eval('!!document.querySelector(".lab-snapshot-error")'),'An invalid saved file is rejected visibly');
      assert.equal(await first.eval('document.querySelectorAll(".lab-saved-analysis .lab-answer-chart circle").length'),3,'A rejected file preserves the previous saved preview');
      await first.eval('document.querySelector(".lab-open-analysis").click()');
      respondToFileDialog(undefined,'Open BOLT analysis');
      await eventually(async()=>await first.eval('document.querySelector(".lab-snapshot-status")?.textContent === "Open cancelled."'),'Cancelling the picker is explicit');
      assert.equal(await first.eval('document.querySelectorAll(".lab-saved-analysis .lab-answer-chart circle").length'),3,'Cancelling an open does not discard the previous preview');
      await first.eval('document.querySelector(".lab-close-analysis").click()');
      await eventually(async()=>await first.eval('!document.querySelector(".lab-saved-analysis")'),'Closing saved review leaves the live dataset in place');
      assert.equal(await first.eval('document.querySelectorAll(".lab-ask-turn").length'),beforeOpen,'Close preview does not reset live questions');
      console.log('PASS: packaged analysis snapshot saves and reopens charts/evidence through native dialogs; invalid/cancel/close leave live questions unchanged');
    }
    assert.equal(modelRequests.length,0,'Chart calculation and export must not call the model');
    async function askLocal(question) {
      const before=await first.eval('document.querySelectorAll(".lab-ask-turn").length');
      await first.eval('document.querySelector(".lab-ask-composer textarea").focus()');
      await first.send('Input.insertText',{text:question});
      await eventually(async()=>await first.eval(
        '!document.querySelector(".lab-ask-composer button")?.disabled'
      ),'Local follow-up is ready');
      await first.eval('document.querySelector(".lab-ask-composer button").click()');
      await eventually(async()=>await first.eval(
        'document.querySelectorAll(".lab-ask-turn").length > '+before
      ),'Local answer appears for '+question);
    }
    await askLocal('And average?');
    assert.equal(await first.eval(
      'document.querySelector(".lab-ask-turn:last-child .lab-ask-context-resolution")?.textContent?.includes("Mean attendance by month") && document.querySelector(".lab-ask-context-scope")?.textContent?.includes("Mean attendance by month") && document.querySelectorAll(".lab-ask-turn:last-child .lab-answer-chart circle").length === 3'
    ),true,'Follow-up mean retains the observed-date scope and chart');
    await first.eval('document.querySelector(".lab-ask-clear-context").click()');
    await eventually(async()=>await first.eval('!document.querySelector(".lab-ask-context")'),'Context can be cleared explicitly');
    await askLocal('And total?');
    assert.equal(await first.eval(
      'document.querySelector(".lab-ask-turn:last-child .lab-ask-primary")?.textContent?.includes("no previous calculation")'
    ),true,'A follow-up without context clarifies instead of silently changing scope');
    await askLocal('Total attendance');
    assert.equal(await first.eval(
      'document.querySelector(".lab-ask-context-scope")?.textContent === "Total attendance" && document.querySelector(".lab-ask-turn:last-child .lab-ask-primary")?.textContent?.includes("350")'
    ),true,'A fresh full question establishes overall scope');
    await first.eval(
      '(() => { const input=document.querySelector("#bolt-csv-import"); const csv=["month,attendance","2026-01,100","2026-02,120","2026-03,130"].join(String.fromCharCode(10)); const transfer=new DataTransfer(); transfer.items.add(new File([csv],"synthetic-lab.csv",{type:"text/csv"})); input.files=transfer.files; input.dispatchEvent(new Event("change",{bubbles:true})); })()'
    );
    await eventually(async()=>await first.eval(
      'document.querySelector("#bolt-target")?.value === "attendance" && !document.querySelector(".lab-ask-composer")'
    ),'Replacing the source clears target approval and its prior scope');
    await first.eval('document.querySelector(".lab-target-control button").click()');
    await eventually(async()=>await first.eval(
      '!!document.querySelector(".lab-ask-composer") && !document.querySelector(".lab-ask-context") && document.querySelectorAll(".lab-ask-turn").length === 0'
    ),'The replacement dataset begins without old calculation context');
    await askLocal('Total attendance');
    await first.eval(
      '(() => { const select=document.querySelector("#bolt-target"); select.value=""; select.dispatchEvent(new Event("change",{bubbles:true})); })()'
    );
    await eventually(async()=>await first.eval('!document.querySelector(".lab-ask-composer")'),'Clearing the target removes its calculation context');
    await first.eval(
      '(() => { const select=document.querySelector("#bolt-target"); select.value="attendance"; select.dispatchEvent(new Event("change",{bubbles:true})); })()'
    );
    await eventually(async()=>await first.eval(
      'document.querySelector("#bolt-target")?.value === "attendance" && document.querySelector(".lab-target-control button")?.disabled === false'
    ),'The selected target is ready for approval');
    await first.eval('document.querySelector(".lab-target-control button").click()');
    await eventually(async()=>await first.eval(
      '!!document.querySelector(".lab-ask-composer") && !document.querySelector(".lab-ask-context") && document.querySelectorAll(".lab-ask-turn").length === 0'
    ),'Reapproving a target creates fresh question context');
    assert.equal(modelRequests.length,0,'Context resolution and reset make no model calls');
    console.log('PASS: packaged CSV follow-ups retain scope, clear explicitly, clarify without context, and reset on source/target changes');
    async function replaceLocalSource(csv) {
      await first.eval('(() => { const input=document.querySelector("#bolt-csv-import"); const d=new DataTransfer(); d.items.add(new File(['+JSON.stringify(csv)+'],"synthetic-lab.csv",{type:"text/csv"})); input.files=d.files; input.dispatchEvent(new Event("change",{bubbles:true})); })()');
      await eventually(async()=>await first.eval(
        'document.querySelector("#bolt-target")?.value === "attendance" && !document.querySelector(".lab-ask-composer") && document.querySelector(".lab-target-control button")?.disabled === false'
      ),'The replacement subset fixture is profiled without prior approval');
      await first.eval('document.querySelector(".lab-target-control button").click()');
      await eventually(async()=>await first.eval('!!document.querySelector(".lab-ask-composer")'),'Replacement target is approved');
    }
    await replaceLocalSource('month,region,attendance\n2026-01,East,100\n2026-01,East,120\n2026-02,East,130\n2026-01,West,300\n2026-02,West,400\n2026-03,West,500');
    async function applyEastFilter() {
      await first.eval('(() => { const s=document.querySelector("#bolt-filter-column"); s.value="region"; s.dispatchEvent(new Event("change",{bubbles:true})); })()');
      await eventually(async()=>await first.eval('document.querySelector("#bolt-filter-value")?.disabled === false'),'Category value is ready');
      await first.eval('document.querySelector("#bolt-filter-value").focus()');
      await first.send('Input.insertText',{text:'East'});
      await eventually(async()=>await first.eval('document.querySelector(".lab-filter-apply")?.disabled === false'),'Filter is ready to apply');
      await first.eval('document.querySelector(".lab-filter-apply").click()');
      await eventually(async()=>await first.eval(
        'document.querySelector(".lab-filter-scope")?.textContent?.includes("East") && document.querySelectorAll(".lab-ask-turn").length === 0'
      ),'Applying the category filter resets the previous answer scope');
    }
    await applyEastFilter();
    await first.eval('document.querySelector(".lab-analyze-button").click()');
    await eventually(async()=>await first.eval(
      'document.querySelector(".lab-analysis-provenance")?.textContent?.includes("3 matching rows / 6 accepted") && document.querySelector(".lab-analysis-kpis")?.textContent?.includes("350")'
    ),'Local analysis uses the same matching subset and counts source coverage');
    await askLocal('Total attendance by region');
    assert.equal(await first.eval(
      'document.querySelector(".lab-ask-turn:last-child .lab-ask-table-scroll")?.textContent?.includes("350") && document.querySelector(".lab-ask-turn:last-child .lab-ask-evidence")?.textContent?.includes("3 matching rows / 6 accepted")'
    ),true,'Subset answers use only East rows');
    await askLocal('And average?');
    assert.equal(await first.eval(
      'document.querySelector(".lab-ask-turn:last-child .lab-ask-table-scroll")?.textContent?.includes("116.67") && document.querySelector(".lab-ask-turn:last-child .lab-ask-context-resolution")?.textContent?.includes("Mean attendance by region")'
    ),true,'Follow-up calculations retain the applied subset');
    if(process.platform==='win32'){
      const filteredReport=path.join(sandbox,'synthetic-subset.html');
      await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-save-report").click()');
      respondToSaveDialog(filteredReport);
      await eventually(async()=>existsSync(filteredReport)&&await first.eval(
        'document.querySelector(".lab-ask-turn:last-child .lab-ask-export-status")?.textContent === "Analysis report saved."'
      ),'A filtered report saves through the native dialog');
      const html=readFileSync(filteredReport,'utf8');
      assert.ok(html.includes('East')&&html.includes('Local category filter')&&html.includes('3 matching rows / 6 accepted')&&html.includes('116.67'));
    }
    await first.eval('document.querySelector(".lab-filter-apply").click()');
    await eventually(async()=>await first.eval(
      '!document.querySelector(".lab-ask-context") && !document.querySelector(".lab-analysis-results") && document.querySelectorAll(".lab-ask-turn").length === 0'
    ),'Reapplying the identical filter resets questions, follow-up context and local analysis');
    await first.eval('document.querySelector(".lab-filter-clear").click()');
    await eventually(async()=>await first.eval(
      '!document.querySelector(".lab-filter-clear") && !document.querySelector(".lab-ask-context") && document.querySelectorAll(".lab-ask-turn").length === 0'
    ),'Clearing the filter clears results and reusable question context');
    await askLocal('Total attendance');
    assert.equal(await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-primary")?.textContent?.includes("1,550")'),true,'Clear filter restores the complete source total');
    await applyEastFilter();
    await replaceLocalSource('month,attendance\n2026-01,100\n2026-02,120\n2026-03,130');
    assert.equal(await first.eval(
      '!document.querySelector(".lab-filter-clear") && document.querySelector(".lab-filter-scope")?.textContent === "All accepted CSV rows"'
    ),true,'Source replacement clears the active category filter');
    assert.equal(modelRequests.length,0,'Category matching, calculations and exports do not call the model');
    console.log('PASS: packaged category filter applies to analysis, answers and follow-ups; saved reports retain scope; clearing/source replacement reset results');
    async function setDateValue(selector,value) {
      await first.eval('(() => { const input=document.querySelector('+JSON.stringify(selector)+'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; setter.call(input,'+JSON.stringify(value)+'); input.dispatchEvent(new Event("input",{bubbles:true})); input.dispatchEvent(new Event("change",{bubbles:true})); })()');
    }
    async function draftDateRange(from,to) {
      await first.eval('(() => { const input=document.querySelector("#bolt-date-filter-column"); input.value="month"; input.dispatchEvent(new Event("change",{bubbles:true})); })()');
      await eventually(async()=>await first.eval('document.querySelector("#bolt-date-filter-from")?.disabled === false'),'Date range controls are ready');
      await setDateValue('#bolt-date-filter-from',from);
      await setDateValue('#bolt-date-filter-to',to);
      await eventually(async()=>await first.eval('document.querySelector(".lab-filter-apply")?.disabled === false'),'A bounded date range can be applied');
    }
    await draftDateRange('2026-02-01','2026-03-31');
    await first.eval('document.querySelector(".lab-filter-apply").click()');
    await eventually(async()=>await first.eval(
      'document.querySelector(".lab-filter-scope")?.textContent?.includes("2026-02-01") && document.querySelector(".lab-filter-scope")?.textContent?.includes("2026-03-31") && document.querySelectorAll(".lab-ask-turn").length === 0'
    ),'A date-only range establishes a new local calculation scope');
    await first.eval('document.querySelector(".lab-analyze-button").click()');
    await eventually(async()=>await first.eval(
      'document.querySelector(".lab-analysis-provenance")?.textContent?.includes("2 matching rows / 3 accepted") && document.querySelector(".lab-analysis-kpis")?.textContent?.includes("250")'
    ),'Local analysis applies the date range before calculating totals');
    await askLocal('Total attendance');
    assert.equal(await first.eval(
      'document.querySelector(".lab-ask-turn:last-child .lab-ask-primary")?.textContent?.includes("250") && document.querySelector(".lab-ask-turn:last-child .lab-ask-evidence")?.textContent?.includes("2 matching rows / 3 accepted")'
    ),true,'Date-only questions use matching records');
    await askLocal('And average?');
    assert.equal(await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-primary")?.textContent?.includes("125")'),true,'Date-filtered follow-ups use a fresh matching-row mean');
    await askLocal('Show attendance over time');
    assert.equal(await first.eval('document.querySelectorAll(".lab-ask-turn:last-child .lab-answer-chart circle").length'),2,'A date-range chart contains only retained matching keys');
    if(process.platform==='win32'){
      const datedReport=path.join(sandbox,'synthetic-date-range.html');
      await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-save-report").click()');
      respondToSaveDialog(datedReport);
      await eventually(async()=>existsSync(datedReport)&&await first.eval(
        'document.querySelector(".lab-ask-turn:last-child .lab-ask-export-status")?.textContent === "Analysis report saved."'
      ),'A date-range report saves through the native dialog');
      const html=readFileSync(datedReport,'utf8');
      for(const text of ['2026-02-01','2026-03-31','first day','2 matching rows / 3 accepted','120','130'])assert.ok(html.includes(text),'Date-range report retains '+text);
    }
    const beforeInvalid=await first.eval('document.querySelectorAll(".lab-ask-turn").length');
    await setDateValue('#bolt-date-filter-to','2026-01-31');
    await first.eval('document.querySelector(".lab-filter-apply").click()');
    await eventually(async()=>await first.eval(
      'document.querySelector(".lab-filter-panel .lab-error")?.textContent?.includes("start must be on or before end")'
    ),'A reversed date range reports an explicit validation error');
    assert.equal(await first.eval('document.querySelectorAll(".lab-ask-turn").length'),beforeInvalid,'An invalid draft keeps the prior answer scope');
    assert.equal(await first.eval('document.querySelector(".lab-filter-scope")?.textContent?.includes("2026-03-31")'),true,'Invalid draft bounds do not replace the applied range');
    await setDateValue('#bolt-date-filter-to','2026-03-31');
    await first.eval('document.querySelector(".lab-filter-apply").click()');
    await eventually(async()=>await first.eval(
      'document.querySelectorAll(".lab-ask-turn").length === 0 && !document.querySelector(".lab-analysis-results") && !document.querySelector(".lab-ask-context")'
    ),'Identical date-range reapplication resets all previous calculations');
    await first.eval('document.querySelector(".lab-filter-clear").click()');
    await eventually(async()=>await first.eval(
      'document.querySelector(".lab-filter-scope")?.textContent === "All accepted CSV rows" && !document.querySelector(".lab-filter-clear")'
    ),'Clear filter removes both category and date constraints');
    await askLocal('Total attendance');
    assert.equal(await first.eval('document.querySelector(".lab-ask-turn:last-child .lab-ask-primary")?.textContent?.includes("350")'),true,'Clearing a date filter restores the complete source total');
    await replaceLocalSource('month,region,attendance\n2026-01,East,100\n2026-01,East,120\n2026-02,East,130\n2026-01,West,300\n2026-02,West,400\n2026-03,West,500');
    await applyEastFilter();
    await draftDateRange('2026-02-01','2026-02-28');
    await first.eval('document.querySelector(".lab-filter-apply").click()');
    await eventually(async()=>await first.eval(
      'document.querySelector(".lab-filter-scope")?.textContent?.includes("East") && document.querySelector(".lab-filter-scope")?.textContent?.includes("2026-02-28")'
    ),'Category and date constraints apply as an intersection');
    await askLocal('Total attendance');
    assert.equal(await first.eval(
      'document.querySelector(".lab-ask-turn:last-child .lab-ask-primary")?.textContent?.includes("130") && document.querySelector(".lab-ask-turn:last-child .lab-ask-evidence")?.textContent?.includes("1 matching rows / 6 accepted")'
    ),true,'The combined scope retains only East February attendance');
    await first.eval('(() => { const input=document.querySelector("#bolt-target"); input.value=""; input.dispatchEvent(new Event("change",{bubbles:true})); })()');
    await eventually(async()=>await first.eval('!document.querySelector(".lab-ask-composer")'),'Target changes remove the former filtered question scope');
    await first.eval('(() => { const input=document.querySelector("#bolt-target"); input.value="attendance"; input.dispatchEvent(new Event("change",{bubbles:true})); })()');
    await eventually(async()=>await first.eval('document.querySelector(".lab-target-control button")?.disabled === false'),'The target can be approved again');
    await first.eval('document.querySelector(".lab-target-control button").click()');
    await eventually(async()=>await first.eval(
      '!!document.querySelector(".lab-ask-composer") && document.querySelector(".lab-filter-scope")?.textContent === "All accepted CSV rows"'
    ),'Reapproving a target clears both former filters');
    await draftDateRange('2026-02-01','2026-02-28');
    await first.eval('document.querySelector(".lab-filter-apply").click()');
    await eventually(async()=>await first.eval('!!document.querySelector(".lab-filter-clear")'),'Date filter is active before source replacement');
    await replaceLocalSource('month,attendance\n2026-01,100\n2026-02,120\n2026-03,130');
    assert.equal(await first.eval('document.querySelector(".lab-filter-scope")?.textContent === "All accepted CSV rows" && !document.querySelector(".lab-filter-clear")'),true,'Source replacement clears the prior date range');
    assert.equal(modelRequests.length,0,'Date filtering, report generation and resets make no model calls');
    console.log('PASS: packaged date ranges filter analysis, questions, follow-ups and charts; reports retain convention; invalid/reapply/clear/target/source resets work');
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
    if(process.platform==='win32'){
      const requestsBeforeOpen=modelRequests.length;
      await second.eval('([...document.querySelectorAll("button.workspace-button")].find(x=>x.textContent.includes("Data Lab")))?.click()');
      await eventually(async()=>await second.eval(
        'getComputedStyle(document.querySelector("main.data-lab")).display !== "none" && !!document.querySelector(".lab-open-analysis")'
      ),'Saved analyses can be opened before importing a CSV after restart');
      assert.equal(await second.eval('!!document.querySelector(".lab-result-header") || !!document.querySelector(".lab-ask-composer")'),false,'The restarted app has no imported live CSV');
      const storedSnapshot=JSON.parse(readFileSync(snapshotPath,'utf8'));
      assert.equal(storedSnapshot.sourceName,'synthetic-lab.csv','The saved file survives process restart');
      assert.deepEqual(storedSnapshot.result.chart.points.map(p=>p.value),[100,120,130]);
      await second.eval('document.querySelector(".lab-open-analysis").click()');
      respondToFileDialog(snapshotPath,'Open BOLT analysis');
      await eventually(async()=>{
        const state=await second.eval('({source:document.querySelector(".lab-snapshot-metadata")?.textContent||"",points:document.querySelectorAll(".lab-saved-analysis .lab-answer-chart circle").length,status:document.querySelector(".lab-snapshot-status")?.textContent||"",error:document.querySelector(".lab-snapshot-error")?.textContent||"",opening:document.querySelector(".lab-open-analysis")?.disabled})');
        if(state.source.includes('synthetic-lab.csv')&&state.points===3)return true;
        throw new Error('Saved-review state: '+JSON.stringify(state));
      },'A saved chart and evidence reopen after process restart without source reimport');
      assert.equal(await second.eval('!!document.querySelector(".lab-ask-composer") || !!document.querySelector(".lab-ask-context")'),false,'Saved review cannot create live target approval or follow-up context');
      assert.equal(modelRequests.length,requestsBeforeOpen,'Reopening a saved snapshot makes no model call');
      console.log('PASS: packaged analysis snapshot reopens after app restart without importing the source CSV or executing a model/calculation');
    }

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
