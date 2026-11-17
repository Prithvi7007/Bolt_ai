'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {validateRequest, backendCommand, readyPort} = require('./runtime.cjs');
const {PassThrough} = require('node:stream');
const {EventEmitter} = require('node:events');

const id='f'.repeat(32);
test('IPC permits only known routes and methods', () => {
  assert.deepEqual(validateRequest('/health'), {method:'GET',body:undefined});
  assert.deepEqual(validateRequest('/v1/sessions', {method:'POST'}), {method:'POST',body:undefined});
  assert.deepEqual(validateRequest(`/v1/sessions/${id}/turns`), {method:'GET',body:undefined});
  assert.equal(validateRequest('/v1/chat',{method:'POST',body:JSON.stringify({session_id:id,question:'revenue'})}).method,'POST');
  for(const route of ['/etc/passwd','http://other/health','/v1/../../health','/v1/chat?x=1','/v1/admin','/v1/sessions/abc/turns']) {
    assert.throws(()=>validateRequest(route), /Unsupported/);
  }
  assert.throws(()=>validateRequest('/v1/sessions',{method:'DELETE'}));
  assert.throws(()=>validateRequest('/health',{method:'POST'}));
  assert.throws(()=>validateRequest('/v1/chat',{method:'POST',body:'{}'}));
  assert.throws(()=>validateRequest('/v1/chat',{method:'POST',body:JSON.stringify({session_id:id,question:'ok',admin:true})}));
  assert.throws(()=>validateRequest('/health',{body:'evil'}));
});

test('IPC validates governed catalog, presentation, and scoped artifact routes', () => {
  assert.deepEqual(validateRequest('/v1/catalog'), {method:'GET',body:undefined});
  const presentation=validateRequest('/v1/presentations',{
    method:'POST',
    body:JSON.stringify({session_id:id,title:'Leadership brief'})
  });
  assert.equal(presentation.method,'POST');
  assert.deepEqual(JSON.parse(presentation.body),{session_id:id,title:'Leadership brief'});
  assert.deepEqual(validateRequest(`/v1/artifacts?session_id=${id}`),{method:'GET',body:undefined});
  assert.deepEqual(
    validateRequest(`/v1/artifacts/${'a'.repeat(32)}?session_id=${id}`),
    {method:'GET',body:undefined}
  );
  assert.throws(()=>validateRequest('/v1/presentations',{method:'POST',body:'{}'}),/Invalid/);
  assert.throws(()=>validateRequest(`/v1/artifacts?session_id=${id}&admin=1`),/Unsupported/);
  assert.throws(()=>validateRequest(
    `/v1/artifacts/${'a'.repeat(32)}?session_id=${'x'.repeat(32)}`
  ),/Unsupported/);
});

test('packaged backend resolves by operating system without shell', () => {
  const win=backendCommand({isPackaged:true,resourcesPath:'C:/resources',appPath:'ignored',userData:'C:/userdata',platform:'win32'});
  assert.equal(path.basename(win.command),'bolt-service.exe');
  assert.equal(win.args[0],'--db');
  const lin=backendCommand({isPackaged:true,resourcesPath:'/tmp/resources',appPath:'ignored',userData:'/tmp/user',platform:'linux'});
  assert.equal(path.basename(lin.command),'bolt-service');
  const dev=backendCommand({isPackaged:false,appPath:'/tmp/bolt/apps/desktop',userData:'/tmp/data',platform:'linux'});
  assert.equal(dev.command,'python3');
  assert.deepEqual(dev.args.slice(0,3),['-m','bolt.desktop_service','--db']);
});

test('readiness handshake accepts only valid loopback port lines', async () => {
  const fake=new EventEmitter(); fake.stdout=new PassThrough();
  const result=readyPort(fake,500);
  fake.stdout.write('some info\nBOLT_READY 48523\n');
  assert.equal(await result,48523);
});

test('invalid ready port fails closed', async () => {
  const fake=new EventEmitter(); fake.stdout=new PassThrough();
  const result=readyPort(fake,500);
  fake.stdout.write('BOLT_READY 99999\n');
  await assert.rejects(result,/Invalid BOLT API port/);
});

test('child token is private and only allowlisted routes are proxied', async () => {
  const {startBackend} = require('./runtime.cjs');
  let spawnOptions;
  const fake = new EventEmitter();
  fake.stdout = new PassThrough();
  fake.stderr = new PassThrough();
  fake.exitCode = null;
  fake.signalCode = null;
  let terminated = false;
  fake.kill = () => { terminated = true; };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({url,options});
    return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({mode:'synthetic'})};
  };
  const backend = await startBackend({command:'fake-python',args:['-m','bolt.desktop_service'],cwd:process.cwd(),bundled:false}, {
    spawnProcess: (_command,_args, opts) => {
      spawnOptions=opts;
      queueMicrotask(()=>fake.stdout.write('BOLT_READY 45678\n'));
      return fake;
    },
    fetchImpl,
  });
  assert.equal(backend.port,45678);
  assert.equal(spawnOptions.shell,false);
  assert.equal(spawnOptions.env.BOLT_DESKTOP_CHILD,'1');
  assert.equal(spawnOptions.env.BOLT_API_TOKEN.length,64);
  assert.equal(Object.keys(backend).includes('token'),false);
  assert.equal(requests[0].url,'http://127.0.0.1:45678/health');
  assert.equal(requests[0].options.headers.Authorization,'Bearer '+spawnOptions.env.BOLT_API_TOKEN);
  await backend.request('/v1/sessions');
  assert.equal(requests.length,2);
  await assert.rejects(()=>backend.request('https://attacker.example/'),/Unsupported/);
  assert.equal(requests.length,2);
  backend.stop(); backend.stop();
  assert.equal(terminated,true);
});


test('IPC validates memory, collection, data source, chart, and settings routes', () => {
  assert.deepEqual(validateRequest('/v1/preferences'), {method:'GET',body:undefined});
  assert.deepEqual(validateRequest('/v1/collections'), {method:'GET',body:undefined});
  assert.deepEqual(validateRequest('/v1/artifacts/all'), {method:'GET',body:undefined});
  assert.deepEqual(validateRequest('/v1/data-sources'), {method:'GET',body:undefined});
  const postCases = [
    ['/v1/preferences',{key:'default_metric',value:'revenue'}],
    ['/v1/memory/search',{query:'revenue',limit:10}],
    ['/v1/memory/erase',{confirmation:'ERASE MY BOLT MEMORY'}],
    ['/v1/collections',{name:'Leadership'}],
    ['/v1/collection-items',{collection_id:id,session_id:id,result_ref:'q1',title:'Revenue'}],
    ['/v1/charts',{session_id:id,query_id:'q1'}],
  ];
  for (const [route,payload] of postCases) {
    const result=validateRequest(route,{method:'POST',body:JSON.stringify(payload)});
    assert.equal(result.method,'POST');
    assert.deepEqual(JSON.parse(result.body),payload);
  }
  assert.throws(()=>validateRequest('/v1/memory/erase',{
    method:'POST',body:JSON.stringify({confirmation:'erase'})
  }),/Invalid/);
  assert.throws(()=>validateRequest('/v1/preferences',{
    method:'POST',body:JSON.stringify({key:'x',value:'y',admin:true})
  }),/Invalid/);
});


test('workflow transport uses private routes and status-only receipts', async () => {
  const {startBackend} = require('./runtime.cjs');
  const fake = new EventEmitter();
  fake.stdout = new PassThrough();fake.stderr = new PassThrough();
  fake.exitCode = null;fake.signalCode = null;fake.kill = () => {};
  const requests = [];
  const backend = await startBackend({command:'fake-python',args:[],cwd:process.cwd(),bundled:false}, {
    spawnProcess: () => {queueMicrotask(()=>fake.stdout.write('BOLT_READY 45678\n'));return fake;},
    fetchImpl: async (url,options) => {
      requests.push({url,options});
      return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({mode:'synthetic'})};
    },
  });
  try {
    const schema={question:'A quick snapshot',target:'income',columns:[{name:'income',type:'numeric'}]};
    await backend.planData(schema);
    await backend.completeDataRun({run_id:id,status:'completed'});
    assert.equal(requests[1].url,'http://127.0.0.1:45678/_desktop/data/runs');
    assert.deepEqual(JSON.parse(requests[1].options.body),schema);
    assert.equal(requests[2].url,'http://127.0.0.1:45678/_desktop/data/complete');
    assert.deepEqual(JSON.parse(requests[2].options.body),{run_id:id,status:'completed'});
    assert.equal(requests[2].options.headers.Authorization.length,71);
    await assert.rejects(()=>backend.completeDataRun({run_id:id,status:'completed',rows:[['secret']]}),/Invalid/);
    await assert.rejects(()=>backend.planData({...schema,filename:'secret.csv'}),/Invalid/);
    assert.equal(requests.length,3,'Rejected fields must not reach the local service');
  } finally {backend.stop();}
});

test('local PowerPoint transport is authenticated, bounded and inaccessible through generic IPC',async()=>{
  const {startBackend}=require('./runtime.cjs');
  const fake=new EventEmitter();
  fake.stdout=new PassThrough();fake.stderr=new PassThrough();
  fake.exitCode=null;fake.signalCode=null;fake.kill=()=>{};
  const requests=[];
  const backend=await startBackend({command:'fake-python',args:[],cwd:process.cwd(),bundled:false},{
    spawnProcess:()=>{queueMicrotask(()=>fake.stdout.write('BOLT_READY 45678\n'));return fake;},
    fetchImpl:async(url,options)=>{
      requests.push({url,options});
      return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({mode:'synthetic'})};
    },
  });
  const input={format:'pptx',sourceName:'synthetic.csv',target:'attendance',question:'What is the total attendance?',
    interpretation:'local',result:{title:'Total attendance',answer:'350',table:[],
      calculation:'Sum',evidence:'3 numeric target rows',warnings:[]}};
  try{
    await backend.createDataPresentation(input);
    assert.equal(requests[1].url,'http://127.0.0.1:45678/_desktop/data/presentation');
    assert.deepEqual(JSON.parse(requests[1].options.body),input);
    assert.match(requests[1].options.headers.Authorization,/^Bearer [a-f0-9]{64}$/);
    await assert.rejects(()=>backend.createDataPresentation({...input,rows:[['secret']]}),/Invalid/);
    await assert.rejects(()=>backend.request('/_desktop/data/presentation',{method:'POST',body:'{}'}),/Unsupported/);
    assert.equal(requests.length,2,'Invalid fields cannot reach the sidecar');
  }finally{backend.stop();}
});
