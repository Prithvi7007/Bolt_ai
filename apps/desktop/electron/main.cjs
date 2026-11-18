// BOLT desktop owns its authenticated, loopback-only synthetic Python sidecar.
// No tokens or arbitrary APIs are exposed to the renderer.
const {app, BrowserWindow, ipcMain, dialog, safeStorage} = require('electron');
const {createModelSettings} = require('./model-settings.cjs');
const {saveDataAnswer} = require('./data-answer-export.cjs');
const {openDataAnalysis} = require('./analysis-snapshot.cjs');
const path = require('node:path');
const fs = require('node:fs');
const {isAllowedNavigation} = require('./navigation.cjs');
const {backendCommand, startBackend} = require('./runtime.cjs');

const DEV_URL = 'http://127.0.0.1:5173/';
let backend = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1500, height: 960, minWidth: 1024, minHeight: 660,
    backgroundColor: '#0F172A', show: false,
    title: 'BOLT AI — Decision Intelligence',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: process.env.BOLT_DEV === '1',
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    const allowed = isAllowedNavigation(navigationUrl, process.env.BOLT_DEV === '1',
      DEV_URL, path.join(__dirname, '../dist/index.html'));
    if (!allowed) event.preventDefault();
  });
  win.once('ready-to-show', () => win.show());
  const built = path.join(__dirname, '../dist/index.html');
  if (process.env.BOLT_DEV === '1') {
    win.loadURL(DEV_URL);
  } else if (fs.existsSync(built)) {
    win.loadFile(built);
  } else {
    console.error('BOLT desktop build missing. Run npm run build before npm start.');
    app.quit();
  }
}

app.whenReady().then(async () => {
  try {
    backend = await startBackend(backendCommand({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      userData: app.getPath('userData'),
      pythonCommand: process.env.BOLT_PYTHON || undefined,
    }));
    const modelSettings = createModelSettings({directory:app.getPath('userData'), safeStorage, backend});
    await modelSettings.restore();
    ipcMain.handle('bolt:model-settings', async (event, operation, settings) => {
      const source = event.senderFrame?.url;
      if (event.senderFrame !== event.sender.mainFrame
          || !isAllowedNavigation(source, process.env.BOLT_DEV === '1',
            DEV_URL, path.join(__dirname, '../dist/index.html'))) {
        throw new Error('Unauthorized BOLT renderer');
      }
      if (operation === 'get') return modelSettings.get();
      if (operation === 'save') return modelSettings.save(settings);
      if (operation === 'test') return modelSettings.test();
      if (operation === 'disconnect') return modelSettings.disconnect();
      throw new Error('Unsupported model operation');
    });
    ipcMain.handle('bolt:plan-data', async (event, input) => {
      const source = event.senderFrame?.url;
      if (event.senderFrame !== event.sender.mainFrame
          || !isAllowedNavigation(source, process.env.BOLT_DEV === '1',
            DEV_URL, path.join(__dirname, '../dist/index.html'))) {
        throw new Error('Unauthorized BOLT renderer');
      }
      if (!backend) throw new Error('BOLT local backend is unavailable');
      return backend.planData(input);
    });
    ipcMain.handle('bolt:complete-data-run', async (event, input) => {
      const source = event.senderFrame?.url;
      if (event.senderFrame !== event.sender.mainFrame
          || !isAllowedNavigation(source, process.env.BOLT_DEV === '1',
            DEV_URL, path.join(__dirname, '../dist/index.html'))) {
        throw new Error('Unauthorized BOLT renderer');
      }
      if (!backend) throw new Error('BOLT local backend is unavailable');
      return backend.completeDataRun(input);
    });
    ipcMain.handle('bolt:request', async (event, route, options) => {
      // Do not let subframes or an unexpectedly navigated page query local data.
      const source = event.senderFrame?.url;
      if (!isAllowedNavigation(source, process.env.BOLT_DEV === '1',
          DEV_URL, path.join(__dirname, '../dist/index.html'))) {
        throw new Error('Unauthorized BOLT renderer');
      }
      if (!backend) throw new Error('BOLT local backend is unavailable');
      return backend.request(route, options);
    });
    ipcMain.handle('bolt:save-data-answer', async (event, input) => {
      const source = event.senderFrame?.url;
      if (event.senderFrame !== event.sender.mainFrame
          || !isAllowedNavigation(source, process.env.BOLT_DEV === '1',
            DEV_URL, path.join(__dirname, '../dist/index.html'))) {
        throw new Error('Unauthorized BOLT renderer');
      }
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner) throw new Error('BOLT window is unavailable');
      return saveDataAnswer(input, {
        showSaveDialog: options => {
          owner.show();
          owner.focus();
          return dialog.showSaveDialog(owner, options);
        },
        writeFile: fs.promises.writeFile,
        createPresentation: input => {
          if (!backend) throw new Error('PowerPoint generation is unavailable');
          return backend.createDataPresentation(input);
        },
      });
    });
    ipcMain.handle('bolt:open-data-analysis', async (event, ...args) => {
      const source=event.senderFrame?.url;
      if(args.length||event.senderFrame!==event.sender.mainFrame
        ||!isAllowedNavigation(source,process.env.BOLT_DEV==='1',
          DEV_URL,path.join(__dirname,'../dist/index.html'))){
        throw new Error('Unauthorized BOLT saved-analysis request');
      }
      const owner=BrowserWindow.fromWebContents(event.sender);
      if(!owner)throw new Error('BOLT window is unavailable');
      return openDataAnalysis({showOpenDialog:options=>{
        // A native picker needs a visible owner, including after a cold restart.
        owner.show();
        owner.focus();
        return dialog.showOpenDialog(owner,options);
      }});
    });
    ipcMain.handle('bolt:save-artifact', async (event, artifactId, sessionId, filename) => {
      const source = event.senderFrame?.url;
      if (!isAllowedNavigation(source, process.env.BOLT_DEV === '1',
          DEV_URL, path.join(__dirname, '../dist/index.html'))) {
        throw new Error('Unauthorized BOLT renderer');
      }
      if (!backend) throw new Error('BOLT local backend is unavailable');
      if (!/^[a-f0-9]{32}$/.test(artifactId) || !/^[a-f0-9]{32}$/.test(sessionId)) {
        throw new Error('Invalid artifact reference');
      }
      const safeName = path.basename(String(filename || 'BOLT_artifact.pptx'));
      const extension = path.extname(safeName).toLowerCase();
      if (!['.pptx', '.svg'].includes(extension) || safeName.length > 100 || safeName !== filename) {
        throw new Error('Invalid artifact filename');
      }
      const response = await backend.request(
        `/v1/artifacts/${artifactId}?session_id=${sessionId}`
      );
      if (!response.ok || typeof response.data?.content_base64 !== 'string') {
        throw new Error('BOLT artifact is unavailable');
      }
      const bytes = Buffer.from(response.data.content_base64, 'base64');
      const validPptx = extension === '.pptx' && bytes[0] === 0x50 && bytes[1] === 0x4b;
      const validSvg = extension === '.svg'
        && bytes.subarray(0, 512).toString('utf8').trimStart().startsWith('<svg');
      if (bytes.length < 4 || bytes.length > 10_000_000 || (!validPptx && !validSvg)) {
        throw new Error('Invalid BOLT artifact');
      }
      const choice = await dialog.showSaveDialog({
        title: 'Save BOLT artifact',
        defaultPath: safeName,
        filters: extension === '.pptx'
          ? [{name: 'PowerPoint Presentation', extensions: ['pptx']}]
          : [{name: 'Scalable Vector Graphic', extensions: ['svg']}],
      });
      if (choice.canceled || !choice.filePath) return {saved:false};
      fs.writeFileSync(choice.filePath, bytes);
      return {saved:true};
    });
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (error) {
    console.error('Unable to initialize BOLT desktop backend:', error.message);
    dialog.showErrorBox('BOLT AI could not start',
      'The local synthetic analytics service could not start. Verify the Python backend is installed and try again.');
    app.quit();
  }
});

app.on('before-quit', () => { backend?.stop(); backend = null; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
