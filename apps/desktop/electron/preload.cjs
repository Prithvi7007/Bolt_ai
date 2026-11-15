'use strict';
// Renderer receives bounded request and artifact-save APIs; no bearer tokens, filesystem or Node access.
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('boltApi', Object.freeze({
  request: (path, options) => ipcRenderer.invoke('bolt:request', path, options),
  saveArtifact: (artifactId, sessionId, filename) =>
    ipcRenderer.invoke('bolt:save-artifact', artifactId, sessionId, filename),
}));
