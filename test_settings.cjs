const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('settings.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const tick = () => new Promise(resolve => setImmediate(resolve));
async function scenario(pending = null) {
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key,{textContent:'',hidden:false,disabled:false,href:'',handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},querySelector:node});
    return nodes.get(key);
  };
  const root={isConnected:true,querySelector:node};
  const timers=new Map(), opened=[], calls=[];
  let counter=0, now=1000, responseStatus=428;
  const details={userCode:'ABCD-1234',verificationUri:'https://feedforge.org/connect/feedback',verificationUriComplete:'https://feedforge.org/connect/feedback?code=ABCD-1234',expiresIn:600,interval:5};
  const context={document:{currentScript:{closest:()=>root}},window:{open:url=>opened.push(url)},navigator:{clipboard:{writeText:async()=>{}}},confirm:()=>true,
    Date:{now:()=>now},setTimeout:fn=>{timers.set(++counter,fn);return counter;},clearTimeout:id=>timers.delete(id),
    fetch:async url=>{calls.push(url);const path=url.split('/').pop();const status=path==='poll'?responseStatus:200;
      return {ok:status<400,status,json:async()=>path==='status'?{connected:false,queued:0,pending}:path==='begin'?details:status===503?{error:'Unavailable'}:{}};}};
  vm.runInNewContext(source,context); await tick();
  const runTimer=async()=>{const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();await tick();};
  return {node,root,timers,opened,calls,runTimer,setStatus:value=>responseStatus=value,expire:()=>now=700000};
}
(async()=>{
  let s=await scenario();
  await s.node('[data-connect]').handlers.click();
  assert.deepEqual(s.opened,['https://feedforge.org/connect/feedback?code=ABCD-1234']);
  assert.equal(s.node('[data-manual]').href,'https://feedforge.org/connect/feedback');
  assert.equal(s.timers.size,1);
  await s.runTimer(); assert.equal(s.timers.size,1);
  s.setStatus(503); await s.runTimer(); assert.equal(s.timers.size,1);
  assert.match(s.node('[data-error]').textContent,/Retrying automatically/);
  await s.node('[data-connect]').handlers.click(); assert.equal(s.timers.size,1);
  s.root.isConnected=false;const count=s.calls.length;await s.runTimer();assert.equal(s.calls.length,count);
  s=await scenario({userCode:'ABCD-1234',verificationUri:'https://feedforge.org/connect/feedback',verificationUriComplete:'https://feedforge.org/connect/feedback?code=ABCD-1234',expiresIn:600,interval:5});
  assert.equal(s.opened.length,0);assert.equal(s.timers.size,1);
  s.expire();await s.runTimer();assert.equal(s.timers.size,0);assert.equal(s.node('[data-status]').textContent,'Connection code expired');
  console.log('Connection UI: correct links, one poll loop, retries, panel close/resume, and expiry passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
