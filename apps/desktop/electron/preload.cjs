'use strict';
// Renderer receives only a bounded request API; no bearer tokens, filesystem or Node access.
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('boltApi', Object.freeze({
  request: (path, options) => ipcRenderer.invoke('bolt:request', path, options),
}));
