import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { parseReliabilityContext } from '@/integrations/reliability/execution-context';
import { prepareOwnedRoot } from '@/integrations/reliability/owned-resources';
import { reliabilityEnvironment } from '@/integrations/reliability/subprocess-environment';
import { spawnOwned, stopOwned } from '@/integrations/reliability/process-ownership';
import { verifyRuntimeIdentity } from '@/integrations/reliability/runtime-identity';
import { verifyHostRestartReadiness } from '@/integrations/reliability/host-ownership';
const exec=promisify(execFile);
test('actual CLI preflight host start/stop then execution-style restart produces sealable readiness', {timeout:120000},async t=>{
 const root=process.cwd(),head='b00744b45fa8714aaadfdd44c47c561c2d905da2';
 const gitEnv={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test' as const};
 const sha=(await exec('git',['rev-parse','HEAD'],{env:gitEnv})).stdout.trim();
 const trees=(await exec('git',['worktree','list','--porcelain'],{env:gitEnv})).stdout.split('\n\n');
 const checkout=trees.find(block=>block.includes(`HEAD ${head}`))?.split('\n')[0].slice('worktree '.length);
 assert.ok(checkout,'Committed scenario worktree required for integration verification');
 const id=`host-cli-test-${randomUUID()}`;
 const off=parseReliabilityContext({version:1,experimentId:id,scenario:'A',mode:'offline',repositoryRoot:root,docsydeSha:sha,requestDeskSha:head,
  outputRoot:join(root,'.artifacts/reliability',id,'A'),runtimeIdentity:null,manifestPath:null});
 await prepareOwnedRoot(off);t.after(()=>rm(dirname(off.outputRoot),{recursive:true}));
 const offPath=join(off.outputRoot,'offline.context.json');await writeFile(offPath,JSON.stringify(off),{flag:'wx'});
 const cli=join(root,'infra/local/reliability/cli.ts');
 await exec(process.execPath,['--conditions=react-server','--import','tsx',cli,'offline','A',checkout,join(off.outputRoot,'offline')],
  {cwd:root,env:reliabilityEnvironment(off,offPath,'tools',{NODE_ENV:'production'}),timeout:60000,maxBuffer:4*1024*1024});
 const gate=JSON.parse(await readFile(join(off.outputRoot,'offline/offline-gate.json'),'utf8'));
 const c=parseReliabilityContext({...off,mode:'scenario',runtimeIdentity:gate.runtimeIdentity,manifestPath:join(off.outputRoot,'manifest.json')});
 const path=join(c.outputRoot,'scenario.context.json');await writeFile(path,JSON.stringify(c),{flag:'wx'});
 const env=reliabilityEnvironment(c,path,'tools',{NODE_ENV:'production'}),tokens=[];
 for(let generation=0;generation<2;generation++) {
  const child=spawnOwned(c,process.execPath,['--conditions=react-server','--import','tsx',cli,'host',c.manifestPath!,checkout],{cwd:root,env,stdio:'ignore'});
  try {
   let healthy=false;
   for(let i=0;i<100;i++){if(child.exitCode!==null)break;try{await verifyRuntimeIdentity('http://127.0.0.1:45873',c.runtimeIdentity!);healthy=true;break}catch{await new Promise(r=>setTimeout(r,150))}}
   assert.equal(healthy,true);
   // Health endpoint can become available just before the launcher journals health.
   for(let i=0;i<40;i++){const record=JSON.parse(await readFile(join(c.outputRoot,'host-process.json'),'utf8'));try{await readFile(join(c.outputRoot,'host-history',record.token+'.healthy.json'));break}catch{await new Promise(r=>setTimeout(r,50))}}
   const record=JSON.parse(await readFile(join(c.outputRoot,'host-process.json'),'utf8'));tokens.push(record.token);
   await assert.rejects(exec(process.execPath,['--conditions=react-server','--import','tsx',cli,'host',c.manifestPath!,checkout],{cwd:root,env,timeout:10000}));
  } finally {await stopOwned(c,child,10000)}
  assert.equal(JSON.parse(await readFile(join(c.outputRoot,'host-process.json'),'utf8')).state,'stopped');
 }
 assert.notEqual(tokens[0],tokens[1]);
 await exec(process.execPath,['--conditions=react-server','--import','tsx',cli,'host-readiness'],{cwd:root,env,timeout:10000});
 await verifyHostRestartReadiness(c,join(c.outputRoot,'host-restart.json'));
});
