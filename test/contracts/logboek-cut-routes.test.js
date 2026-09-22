const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {registerLogboekCutRoutes}=require('../../server/routes/logboek-cut');
test('routes fail closed without access wiring and validate before writing',async t=>{
  const app=express();app.use(express.json());let writes=0,notes=0;
  const service={get:async()=>({ok:true}),set:async()=>{writes++;return {ok:true};},note:async()=>{notes++;return {ok:true};}};
  registerLogboekCutRoutes(app,{service,guard:(req,res,next)=>req.get('x-test-access')==='yes'?next():res.status(401).json({ok:false})});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
  const url=`http://127.0.0.1:${server.address().port}/api/logboek-cut`;
  assert.equal((await fetch(url)).status,401);
  const send=(headers,body='{}')=>fetch(url,{method:'POST',headers:{'x-test-access':'yes',...headers},body});
  assert.equal((await send({'content-type':'application/json',origin:'https://evil.example'})).status,403);
  assert.equal((await send({'content-type':'text/plain',origin:'https://www.softora.nl'})).status,415);
  assert.equal(writes,0);
  assert.equal((await send({'content-type':'application/json',origin:'https://www.softora.nl'})).status,200);assert.equal(writes,1);
  assert.equal((await send({'content-type':'application/json',origin:'https://www.softora.nl'},JSON.stringify({type:'note',order:1,text:'test'}))).status,200);assert.equal(notes,1);
});
