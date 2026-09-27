import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { demoCampaign, fromEntry, changeBattle, migrateCampaign } from '../app/domain.js';
import { findMonsters, monsterEntry } from '../app/bestiary.js';
import { MAX_PROFILE_BYTES, defaultProfile, buildRequest, chatMessage, memoryRecord, profileExport, profileImport } from '../app/assistant.js';
import { importBundle, exportCampaign, validateCampaign } from '../app/backup.js';
import { createAssistantHandler, localOllamaUrl, validateChat } from '../scripts/local-assistant.mjs';
import { createServer } from 'node:http';
const catalog=JSON.parse(await readFile(new URL('../assets/srd-monsters.json',import.meta.url),'utf8'));

test('official SRD catalogue has complete independent stat blocks with verified sample statistics',()=>{
  assert.equal(catalog.monsters.length,330); assert.equal(new Set(catalog.monsters.map(m=>m.id)).size,330);
  assert.equal(catalog.license,'CC-BY-4.0'); assert.match(catalog.source,/media.dndbeyond.com/); assert.match(catalog.attribution,/Wizards of the Coast LLC/);
  const goblin=catalog.monsters.find(m=>m.id==='goblin-warrior');
  assert.deepEqual([goblin.ac,goblin.hp,goblin.initiativeBonus,goblin.cr,goblin.page],[15,10,2,'1/4',290]);
  assert.match(goblin.text,/Nimble Escape/);assert.ok(!goblin.text.includes('Goblin Boss'));
  const aboleth=catalog.monsters.find(m=>m.id==='aboleth');assert.equal(aboleth.hp,150);assert.equal(aboleth.initiativeBonus,7);assert.match(aboleth.text,/Legendary Actions/);
  for(const m of catalog.monsters){assert.ok(Number.isInteger(m.hp)&&m.hp>0);assert.ok(Number.isInteger(m.ac));assert.ok(m.page>=258&&m.page<=364);assert.match(m.text,/CR /);}
});
test('catalogue filters Russian aliases, creature types and zero challenge rating',()=>{
  assert.equal(findMonsters(catalog,{query:'гоблин',type:'Fey',cr:'1/4'}).some(m=>m.id==='goblin-warrior'),true);
  assert.ok(findMonsters(catalog,{query:'dragon',type:'Dragon'}).length>=40);
  assert.ok(findMonsters(catalog,{query:'',cr:'0'}).every(m=>m.cr==='0'));
});
test('official creature copies retain actions and attribution through battle and export',()=>{
  const c=demoCampaign(),m=catalog.monsters.find(m=>m.id==='goblin-warrior'),e=monsterEntry(catalog,m);
  c.entries.push(e);c.battle=changeBattle(c.battle,{type:'add',combatant:fromEntry(e)});
  const copy=importBundle(exportCampaign(c)).campaign;validateCampaign(copy);
  assert.match(copy.battle.combatants.at(-1).notes,/Nimble Escape/);assert.match(copy.entries.at(-1).text,/creativecommons.org/);
  assert.equal(copy.battle.combatants.at(-1).hp,10);assert.notEqual(copy.battle.combatants.at(-1).id,c.battle.combatants.at(-1).id);
});
test('assistant context is bounded, isolates campaigns and uses explicit style feedback',()=>{
  const a=demoCampaign(),b=demoCampaign(),p=defaultProfile();b.entries[0].text='СЕКРЕТ ЧУЖОЙ КАМПАНИИ';
  p.instructions='Короткие описания, без рельсов.';p.memories.push(memoryRecord('Предпочитаю переговоры до боя.'));
  a.assistant.messages.push(chatMessage('user','Что было у маяка?'),chatMessage('assistant','Пока известен только свет.','local'));
  const request=buildRequest(a,p,'Предложи сцену у маяка.',catalog);validateChat(request);
  assert.match(request.messages[0].content,/переговоры до боя/);assert.match(request.messages[0].content,/Мира Вейл/);
  assert.ok(!JSON.stringify(request).includes('СЕКРЕТ ЧУЖОЙ КАМПАНИИ'));assert.equal(request.messages.at(-1).content,'Предложи сцену у маяка.');
  for(const e of a.entries)e.text='Очень длинный текст '.repeat(4000);
  validateChat(buildRequest(a,p,'Сцена у маяка.',catalog));
  const restored=profileImport(profileExport(p));assert.deepEqual(restored,p);
  assert.throws(()=>profileImport('{"application":"another"}'));
});
test('v2 campaigns migrate without deleting audio; v3 backups remap chat IDs',()=>{
  const old=demoCampaign();old.schemaVersion=2;delete old.assistant;
  const upgraded=migrateCampaign(old);assert.equal(upgraded.schemaVersion,3);assert.deepEqual(upgraded.soundboard,old.soundboard);assert.deepEqual(upgraded.assistant.messages,[]);
  upgraded.assistant.messages.push(chatMessage('user','Продолжим'),chatMessage('assistant','Подготовим сцену.','qwen3.5:4b',['К1: Кампания']));
  const copy=importBundle(exportCampaign(upgraded)).campaign;
  assert.notEqual(copy.assistant.messages[0].id,upgraded.assistant.messages[0].id);assert.deepEqual(copy.assistant.messages[1].sources,['К1: Кампания']);
  const envelope=JSON.parse(exportCampaign(upgraded));envelope.formatVersion=2;envelope.campaign=old;
  assert.equal(importBundle(JSON.stringify(envelope)).campaign.schemaVersion,3);
});
test('local assistant rejects external URLs, cloud models and malformed messages',()=>{
  for(const url of ['https://api.example.com','http://192.168.1.2:11434','http://localhost.evil.com','http://localhost:11434/path','http://user:pass@localhost'])assert.throws(()=>localOllamaUrl(url));
  assert.equal(localOllamaUrl('http://127.0.0.1:11434'),'http://127.0.0.1:11434');
  assert.throws(()=>validateChat({model:'qwen-cloud',messages:[]}));
  assert.throws(()=>validateChat({model:'local',messages:[{role:'user',content:'hello'}]}));
});
test('API proxy validates origin, blocks remote models and forwards local conversation without tools',async()=>{
  let remote=false,body;
  const fakeFetch=async(url,options)=>{
    assert.match(url,/^http:\/\/127.0.0.1:11434\//);
    if(url.endsWith('/api/show'))return Response.json({details:{format:'gguf'},capabilities:['completion','thinking'],...(remote?{remote_host:'https://remote.example'}:{})});
    body=JSON.parse(options.body);return Response.json({message:{content:'Сцена у маяка.'},done:true});
  };
  const handler=createAssistantHandler({fetchImpl:fakeFetch});
  const server=createServer((req,res)=>handler(req,res,new URL(req.url,'http://localhost').pathname));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const payload={model:'qwen3.5:4b',messages:[{role:'system',content:'Помоги мастеру.'},{role:'user',content:'Предложи сцену.'}]};
  try{
    assert.equal((await fetch(origin+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify(payload)})).status,403);
    let res=await fetch(origin+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(payload)});
    assert.equal(res.status,200);assert.equal((await res.json()).text,'Сцена у маяка.');assert.equal(body.think,false);assert.equal(body.tools,undefined);assert.equal(body.stream,false);
    remote=true;res=await fetch(origin+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(payload)});assert.equal(res.status,503);assert.match((await res.json()).error,/локальную/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('largest valid Unicode style profile remains importable',()=>{
  const p=defaultProfile();p.instructions='字'.repeat(4000);
  for(let i=0;i<50;i++)p.memories.push(memoryRecord('字'.repeat(2000)));
  const exported=profileExport(p);assert.ok(new TextEncoder().encode(exported).length<=MAX_PROFILE_BYTES);
  assert.deepEqual(profileImport(exported),p);
});
