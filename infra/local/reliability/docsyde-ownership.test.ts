import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { acquireHost, recordHostRestartReadiness } from '@/integrations/reliability/host-ownership';
import { parseReliabilityContext } from '@/integrations/reliability/execution-context';
import { prepareOwnedRoot } from '@/integrations/reliability/owned-resources';
import { spawnOwned } from '@/integrations/reliability/process-ownership';
import { reliabilityEnvironment } from '@/integrations/reliability/subprocess-environment';
async function fixture(t: TestContext) {
 const root=process.cwd(),id=`docsyde-test-${randomUUID()}`;
 const c=parseReliabilityContext({version:1,experimentId:id,scenario:'A',mode:'offline',repositoryRoot:root,docsydeSha:'0'.repeat(40),requestDeskSha:null,outputRoot:join(root,'.artifacts/reliability',id,'A'),runtimeIdentity:null,manifestPath:null});
 await prepareOwnedRoot(c);t.after(()=>rm(dirname(c.outputRoot),{recursive:true}));return c;
}
test('preflight start -> owned stop -> execution restart -> owned stop retains distinct generations',async t=>{
 const c=await fixture(t);const tokens=[];
 for(let i=0;i<2;i++) {
  const lease=await acquireHost(c, 'docsyde');tokens.push(lease.token);
  const child=spawnOwned(c,process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:c.repositoryRoot,env:reliabilityEnvironment(c,'unused','tools'),stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)await lease.stopped(child)});
  await lease.running(child);await assert.rejects(lease.stopped());await assert.rejects(acquireHost(c, 'docsyde'));await lease.stopped(child);
  assert.ok(child.exitCode!==null||child.signalCode!==null);
  assert.equal(JSON.parse(await readFile(join(c.outputRoot,'docsyde-process.json'),'utf8')).state,'stopped');
 }
 assert.notEqual(tokens[0],tokens[1]);
 await assert.rejects(recordHostRestartReadiness(c, 'docsyde'), /host-restart-not-proven/);
});
test('malformed and legacy ownership fail closed without changing evidence',async t=>{
 const c=await fixture(t),path=join(c.outputRoot,'docsyde-process.json');
 for(const bytes of ['{bad','{}',JSON.stringify({pid:process.pid})]){await writeFile(path,bytes);await assert.rejects(acquireHost(c, 'docsyde'));assert.equal(await readFile(path,'utf8'),bytes)}
});
test('concurrent acquisition has one winner; acquiring state never auto-reclaims',async t=>{
 const c=await fixture(t);const results=await Promise.allSettled([acquireHost(c, 'docsyde'),acquireHost(c, 'docsyde')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 await assert.rejects(acquireHost(c, 'docsyde'));const winner=results.find(x=>x.status==='fulfilled');if(winner?.status==='fulfilled')await winner.value.stopped();
});
test('running records are reclaimable only when both process IDs are conclusively dead',async t=>{
 const c=await fixture(t);const child=spawnOwned(c,process.execPath,['-e',''],{cwd:c.repositoryRoot,env:reliabilityEnvironment(c,'unused','tools'),stdio:'ignore'});
 await new Promise<void>((resolve,reject)=>{child.once('exit',()=>resolve());child.once('error',reject)});
 const record={version:2,experimentId:c.experimentId,scenario:'A',token:randomUUID(),launcherPid:child.pid!,childPid:child.pid!,state:'running',runtimeIdentity:null};
 await writeFile(join(c.outputRoot,'docsyde-process.json'),JSON.stringify(record));const next=await acquireHost(c, 'docsyde');assert.notEqual(next.token,record.token);await next.stopped();
});

test('a claimed stop without its matching immutable transition proof is ambiguous', async t=>{
 const c=await fixture(t),path=join(c.outputRoot,'docsyde-process.json');
 const bytes=JSON.stringify({version:2,experimentId:c.experimentId,scenario:'A',token:randomUUID(),launcherPid:process.pid,childPid:null,state:'stopped',runtimeIdentity:null});
 await writeFile(path,bytes);await assert.rejects(acquireHost(c, 'docsyde'),/host-stop-unverifiable/);assert.equal(await readFile(path,'utf8'),bytes);
});
