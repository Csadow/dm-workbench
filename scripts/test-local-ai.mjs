// Optional smoke test against the installed real model; no cloud services.
import assert from 'node:assert/strict';
import { createAppServer } from './serve.mjs';
import { demoCampaign } from '../app/domain.js';
import { defaultProfile, buildRequest } from '../app/assistant.js';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const catalog=JSON.parse(await readFile(new URL('../assets/srd-monsters.json',import.meta.url),'utf8'));
const campaign=demoCampaign(),profile=defaultProfile();
profile.instructions='Отвечай одним коротким предложением по-русски.';
const vaultRoot=await mkdtemp(join(tmpdir(),'dmw-real-memory-'));
await mkdir(join(vaultRoot,'shared'));
await writeFile(join(vaultRoot,'shared','Стиль.md'),'Начинай ответ словом «Проверка».');
const server=createAppServer({vaultRoot});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,start=Date.now();
try {
  const status=await fetch(origin+'/api/ai/status');assert.equal(status.status,200);
  assert.ok((await status.json()).models.includes(profile.model),'model must be installed locally');
  await writeFile(join(vaultRoot,'shared','Стиль.md'),'# Мой стиль\n\nНачинай каждый ответ точными словами «У стола:».');
  await mkdir(join(vaultRoot,'campaigns',campaign.id),{recursive:true});
  await writeFile(join(vaultRoot,'campaigns',campaign.id,'Пароль.md'),'# Пароль Миры\n\nМира Вейл сообщила пароль: медный якорь.');
  const memory=await (await fetch(origin+'/api/memory?campaign='+campaign.id)).json();
  const request=buildRequest(campaign,profile,'Как зовут хозяйку «Солёного ветра», кого она хочет найти и какой пароль сообщила? Возьми пароль из Markdown-памяти.',catalog,memory.files);
  assert.match(request.messages[0].content,/У стола:/);assert.ok(!request.messages[0].content.includes('словом «Проверка»'));
  const response=await fetch(origin+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({model:request.model,messages:request.messages}),signal:AbortSignal.timeout(190000)});
  const data=await response.json();assert.equal(response.status,200,data.error);
  assert.match(data.text,/Мир/);assert.match(data.text,/брат/);assert.match(data.text,/медный якорь/i);
  if(!/У стола:/.test(data.text))console.log('LIMITATION: model used the facts but did not follow the requested style prefix.');
  console.log(`PASS real local model + fresh Markdown fact ${data.model}, ${((Date.now()-start)/1000).toFixed(1)}s: ${data.text}`);
}finally{await new Promise(resolve=>server.close(resolve));await rm(vaultRoot,{recursive:true,force:true});}
