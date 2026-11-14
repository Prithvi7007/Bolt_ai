// Electron is a UI shell only. Secrets, data access and analytics stay in the Python service.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { isAllowedNavigation } = require('./navigation.cjs');

const DEV_URL = 'http://127.0.0.1:5173/';

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
      devTools: process.env.BOLT_DEV === '1'
    }
  });
  // Never allow arbitrary windows or navigation; the renderer requires no external links.
  win.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    const allowed = isAllowedNavigation(
      navigationUrl,
      process.env.BOLT_DEV === '1',
      DEV_URL,
      path.join(__dirname, '../dist/index.html')
    );
    if (!allowed) event.preventDefault();
  });
  win.once('ready-to-show', () => win.show());
  const built = path.join(__dirname,'../dist/index.html');
  if (process.env.BOLT_DEV === '1') {
    win.loadURL(DEV_URL);
  } else if (fs.existsSync(built)) {
    win.loadFile(built);
  } else {
    // Fail closed: the built app must not silently load a server on developer port.
    console.error('BOLT desktop build missing. Run npm run build before npm start.');
    app.quit();
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
