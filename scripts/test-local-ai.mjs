// Optional smoke test against the installed real model; no cloud services.
import assert from 'node:assert/strict';
import { createAppServer } from './serve.mjs';
import { demoCampaign } from '../app/domain.js';
import { defaultProfile, buildRequest, memoryRecord } from '../app/assistant.js';
import { readFile } from 'node:fs/promises';
const catalog=JSON.parse(await readFile(new URL('../assets/srd-monsters.json',import.meta.url),'utf8'));
const campaign=demoCampaign(),profile=defaultProfile();
profile.instructions='Отвечай одним коротким предложением по-русски.';
profile.memories.push(memoryRecord('Начинай ответы словами «У стола:».'));
const request=buildRequest(campaign,profile,'Как зовут хозяйку «Солёного ветра» и кого она хочет найти? Опирайся на записи кампании.',catalog);
const server=createAppServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,start=Date.now();
try {
  const status=await fetch(origin+'/api/ai/status');assert.equal(status.status,200);
  assert.ok((await status.json()).models.includes(profile.model),'model must be installed locally');
  const response=await fetch(origin+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({model:request.model,messages:request.messages}),signal:AbortSignal.timeout(190000)});
  const data=await response.json();assert.equal(response.status,200,data.error);
  assert.match(data.text,/Мир/);assert.match(data.text,/брат/);assert.match(data.text,/У стола:/);
  console.log(`PASS real local model ${data.model}, ${((Date.now()-start)/1000).toFixed(1)}s: ${data.text}`);
}finally{await new Promise(resolve=>server.close(resolve));}
