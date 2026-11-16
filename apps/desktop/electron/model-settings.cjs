'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

function normalizeModelSettings(input, previous = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['endpoint','model','auth_mode','token','timeout_seconds'].includes(key))) {
    throw new Error('Invalid model settings');
  }
  if (typeof input.endpoint !== 'string' || input.endpoint.length > 1000
      || typeof input.model !== 'string' || input.model.length > 200) throw new Error('Enter an endpoint and model name');
  const endpoint = input.endpoint.trim().replace(/\/+$/, '');
  const model = input.model.trim();
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Enter a valid model base URL'); }
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || url.search || url.hash || /\s/.test(endpoint)) {
    throw new Error('Use HTTPS, or HTTP on loopback, without URL credentials or parameters');
  }
  const auth_mode = input.auth_mode;
  if (!['bearer','apim','none'].includes(auth_mode)) throw new Error('Choose a supported authentication method');
  const timeout_seconds = input.timeout_seconds;
  if (!Number.isInteger(timeout_seconds) || timeout_seconds < 1 || timeout_seconds > 120) {
    throw new Error('Timeout must be between 1 and 120 seconds');
  }
  if (input.token !== undefined && typeof input.token !== 'string') throw new Error('Invalid API key');
  let token = input.token || '';
  if (!token && auth_mode !== 'none' && previous?.endpoint === endpoint && previous?.auth_mode === auth_mode) {
    token = previous.token;
  }
  if (token.length > 4096 || /[\x00-\x1f\x7f]/.test(token + model) || !model) throw new Error('Invalid model name or key');
  if (auth_mode !== 'none' && !token) throw new Error('Enter a key for this endpoint');
  if (auth_mode === 'none' && token) throw new Error('Remove the key when choosing no authentication');
  return {endpoint, model, auth_mode, token, timeout_seconds};
}

function createModelSettings({directory, safeStorage, backend}) {
  const filename = path.join(directory, 'model-connection.json');
  let active = null;
  let persisted = false;
  let notice = '';
  let pending = Promise.resolve();
  // Serialize restore/save/test/disconnect so a late probe cannot overwrite new settings.
  const serial = action => {
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  };
  const secure = () => safeStorage.isEncryptionAvailable()
    && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  const status = async () => ({
    ...(await backend.modelStatus()), persisted, notice,
  });
  function writeSaved(config) {
    fs.mkdirSync(directory, {recursive:true});
    const envelope = secure()
      ? {version:1, encrypted:safeStorage.encryptString(JSON.stringify(config)).toString('base64')}
      : config.token ? null : {version:1, config};
    if (envelope === null) {
      if (fs.existsSync(filename)) fs.unlinkSync(filename);
      persisted = false;
      notice = 'Secure storage is unavailable. This connection is active for this session only.';
      return;
    }
    const temporary = filename + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(envelope), {mode:0o600, flag:'wx'});
      fs.renameSync(temporary, filename);
      persisted = true;
      notice = '';
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  return {
    get: () => serial(status),
    restore: () => serial(async () => {
      if (!fs.existsSync(filename)) return status();
      try {
        if (fs.statSync(filename).size > 30_000) throw new Error('Invalid saved settings');
        const envelope = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (envelope.version !== 1) throw new Error('Invalid saved settings');
        let saved;
        if (typeof envelope.encrypted === 'string' && secure()) {
          saved = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64')));
        } else if (envelope.config?.auth_mode === 'none' && envelope.config.token === '') {
          saved = envelope.config;
        } else throw new Error('Protected connection is unavailable');
        const config = normalizeModelSettings(saved);
        await backend.configureModel(config);
        active = config; persisted = true; notice = '';
      } catch {
        notice = 'Saved model connection could not be restored. Enter and save it again.';
      }
      return status();
    }),
    save: input => serial(async () => {
      const config = normalizeModelSettings(input, active);
      await backend.configureModel(config);
      active = config;
      try { writeSaved(config); } catch {
        persisted = false;
        notice = 'Connection is active for this session. Saved settings could not be updated; previous settings may return after restart.';
      }
      return status();
    }),
    test: () => serial(async () => {
      await backend.testModel();
      return status();
    }),
    disconnect: () => serial(async () => {
      await backend.disconnectModel();
      active = null; persisted = false;
      try {
        if (fs.existsSync(filename)) fs.unlinkSync(filename);
        notice = '';
      } catch {
        notice = 'Disconnected for this session. Saved settings could not be removed and may return after restart.';
      }
      return status();
    }),
  };
}

module.exports = {createModelSettings, normalizeModelSettings};
