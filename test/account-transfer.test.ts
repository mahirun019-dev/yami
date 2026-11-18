import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildTransferPackage,decodeBase64,encodeBase64,normalizeTransfer,sha256Hex,transferFingerprint} from '../src/account/legacyTransfer.ts';
import {snapshotBackupIds} from '../src/account/backupFiles.ts';

test('raw legacy archives never become NaN backup requests',()=>{
 assert.deepEqual(snapshotBackupIds([{id:'1793350000000'},{id:'legacy-pre-v5'},{id:'old-export'},{id:'Infinity'},{id:'9007199254740993'}]),[1793350000000]);
});

const data=(companies:unknown[]=[])=>(
  JSON.stringify({schemaVersion:5,companies,events:[],materials:[],interviews:[],preparations:[],templates:[],preferences:{general:{fontSize:'xl'}}})
);

test('transfer package fingerprint is stable and only includes the approved workspace/settings keys',async()=>{
  const storage={'career-flow-data-v5':data([{id:'company-1',name:'A'}]),'careerflow-theme':'dark','careerflow-watch-session':'shared-secret'};
  const first=await buildTransferPackage(storage,[],'2026-10-01T00:00:00Z');
  const second=await buildTransferPackage(storage,[],'2026-10-30T00:00:00Z');
  assert.equal(first.fingerprint,second.fingerprint);
  assert.equal('careerflow-watch-session' in first.storage,false);
});

test('transfer preserves attachment bytes and verifies a stable asset manifest',async()=>{
  const bytes=new TextEncoder().encode('private attachment');
  const asset={kind:'attachments' as const,id:'attachment-1',mediaType:'text/plain',size:bytes.length,sha256:await sha256Hex(bytes),contentBase64:encodeBase64(bytes)};
  const result=await buildTransferPackage({'career-flow-data-v5':data()},[asset]);
  const parsed=normalizeTransfer(result) as typeof result;
  assert.deepEqual(decodeBase64(parsed.assets[0].contentBase64),bytes);
  assert.equal(await transferFingerprint(parsed.storage,parsed.assets),result.fingerprint);
});

test('standard Yami backup JSON converts to a v5 account workspace without deleting its records',()=>{
  const converted=normalizeTransfer({schemaVersion:5,createdAt:12,companies:[{id:'company-1',name:'A'}],schedules:[{id:'event-1'}],resources:[{id:'material-1'}],interviews:[{id:'interview-1'}],preparations:[{id:'prep-1'}],selectionRecords:[{id:'company-1',stage:'first_interview'}],settings:{theme:'light',locale:'ja',preferences:{general:{fontSize:'large'}},templates:[{id:'template-1'}]}});
  const dataValue=JSON.parse(converted.storage['career-flow-data-v5']);
  assert.equal(dataValue.companies.length,1);assert.equal(dataValue.companies[0].stage,'first_interview');
  assert.equal(dataValue.events[0].id,'event-1');assert.equal(dataValue.materials[0].id,'material-1');
  assert.equal(dataValue.interviews[0].id,'interview-1');assert.equal(dataValue.preparations[0].id,'prep-1');assert.equal(dataValue.templates[0].id,'template-1');
  assert.equal(converted.storage['careerflow-theme'],'light');assert.equal(converted.storage['careerflow-locale'],'ja');
});

test('malformed transfer assets and attempts to import arbitrary session/token keys are rejected',async()=>{
  const base=await buildTransferPackage({'career-flow-data-v5':data()},[]);
  assert.throws(()=>normalizeTransfer({...base,storage:{...base.storage,'careerflow-watch-session':'token'}}),/INVALID_TRANSFER_STORAGE/);
  assert.throws(()=>normalizeTransfer({...base,assets:[{kind:'attachments',id:'../other',mediaType:'x',size:0,sha256:'0'.repeat(64),contentBase64:''}]}),/INVALID_TRANSFER_ASSET/);
  const invalid={...base,fingerprint:await sha256Hex('not the package')};
  assert.notEqual(await transferFingerprint(invalid.storage,invalid.assets),invalid.fingerprint);
});
