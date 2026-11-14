// BOLT desktop owns its authenticated, loopback-only synthetic Python sidecar.
// No tokens or arbitrary APIs are exposed to the renderer.
const {app, BrowserWindow, ipcMain, dialog} = require('electron');
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
