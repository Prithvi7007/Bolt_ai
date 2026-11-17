'use strict';
// Renderer receives bounded request and artifact-save APIs; no bearer tokens, filesystem or Node access.
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('boltApi', Object.freeze({
  modelSettings: (operation, settings) => ipcRenderer.invoke('bolt:model-settings', operation, settings),
  planData: input => ipcRenderer.invoke('bolt:plan-data', input),
  request: (path, options) => ipcRenderer.invoke('bolt:request', path, options),
  saveArtifact: (artifactId, sessionId, filename) =>
    ipcRenderer.invoke('bolt:save-artifact', artifactId, sessionId, filename),
}));
