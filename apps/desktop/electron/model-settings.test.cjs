'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createModelSettings, normalizeModelSettings} = require('./model-settings.cjs');
const secret = 'my-private-api-key';
const config = {endpoint:'https://models.example.test/v1',model:'my-model',auth_mode:'apim',token:secret,timeout_seconds:30};
function fixture(t, secure = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-model-test-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  let current = null, verified = false;
  const backend = {
    configureModel:async value=>{current=value;verified=false;},
    testModel:async()=>{if(!current)throw new Error('Save a connection first');verified=true;},
    disconnectModel:async()=>{current=null;verified=false;},
    modelStatus:async()=>({configured:!!current,verified,endpoint:current?.endpoint||'',model:current?.model||'',
      auth_mode:current?.auth_mode||'bearer',timeout_seconds:current?.timeout_seconds||30,has_key:!!current?.token}),
  };
  const safeStorage = {
    isEncryptionAvailable:()=>secure,
    getSelectedStorageBackend:()=>secure?'test-protected':'basic_text',
    encryptString:value=>Buffer.from(Buffer.from(value).toString('base64')),
    decryptString:value=>Buffer.from(value.toString(),'base64').toString(),
  };
  return {directory, backend, safeStorage, manager:createModelSettings({directory,backend,safeStorage})};
}
test('save and restart restore a protected key without returning it', async t=>{
  const f=fixture(t);
  const saved=await f.manager.save(config);
  assert.equal(saved.persisted,true);
  assert.equal(saved.configured,true);
  assert.equal(saved.verified,false);
  assert.equal(JSON.stringify(saved).includes(secret),false);
  const disk=fs.readFileSync(path.join(f.directory,'model-connection.json'),'utf8');
  assert.equal(disk.includes(secret),false);
  assert.equal(disk.includes(config.endpoint),false);
  const restarted=createModelSettings(f);
  const restored=await restarted.restore();
  assert.equal(restored.has_key,true);
  assert.equal(JSON.stringify(restored).includes(secret),false);
  assert.equal((await restarted.test()).verified,true);
  await restarted.disconnect();
  assert.equal(fs.existsSync(path.join(f.directory,'model-connection.json')),false);
  assert.equal((await restarted.get()).configured,false);
});
test('no secure storage means session only; no secret file is written', async t=>{
  const f=fixture(t,false);
  const saved=await f.manager.save(config);
  assert.equal(saved.persisted,false);
  assert.match(saved.notice,/session only/);
  assert.equal(fs.existsSync(path.join(f.directory,'model-connection.json')),false);
  assert.equal(saved.has_key,true);
});
test('Linux basic_text never persists an API key', async t=>{
  const f=fixture(t);
  f.safeStorage.getSelectedStorageBackend=()=> 'basic_text';
  assert.equal((await f.manager.save(config)).persisted,false);
  assert.equal(fs.existsSync(path.join(f.directory,'model-connection.json')),false);
});
test('a key is not reused for a changed endpoint or authentication method', async t=>{
  const f=fixture(t);
  await f.manager.save(config);
  await assert.rejects(()=>f.manager.save({...config,endpoint:'https://other.example.test/v1',token:''}),/Enter a key/);
  await assert.rejects(()=>f.manager.save({...config,auth_mode:'bearer',token:''}),/Enter a key/);
  assert.equal((await f.manager.save({...config,model:'another-model',token:''})).has_key,true);
});
test('no-auth local settings persist without encryption and restore', async t=>{
  const f=fixture(t,false);
  const local={...config,endpoint:'http://127.0.0.1:11434/v1',auth_mode:'none',token:''};
  assert.equal((await f.manager.save(local)).persisted,true);
  assert.equal((await createModelSettings(f).restore()).has_key,false);
});
test('invalid and credential-bearing endpoints never reach backend', ()=>{
  for(const endpoint of ['http://remote.example.test/v1','https://user:pass@example.test/v1','https://example.test/?key=secret','https://example.test/#x']) {
    assert.throws(()=>normalizeModelSettings({...config,endpoint}));
  }
  assert.throws(()=>normalizeModelSettings({...config,token:'key\nheader'}));
  assert.throws(()=>normalizeModelSettings({...config,timeout_seconds:0}));
  assert.throws(()=>normalizeModelSettings({...config,admin:true}));
});
test('corrupt saved settings return a recoverable redacted status', async t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.directory,'model-connection.json'),secret);
  const status=await f.manager.restore();
  assert.equal(status.configured,false);
  assert.match(status.notice,/could not be restored/);
  assert.equal(JSON.stringify(status).includes(secret),false);
});
test('generic renderer API cannot configure or probe credentials', ()=>{
  const {validateRequest}=require('./runtime.cjs');
  for(const route of ['/_desktop/model','/_desktop/model/test','/_desktop/model/disconnect']) {
    assert.throws(()=>validateRequest(route,{method:'POST',body:'{}'}),/Unsupported/);
  }
});
