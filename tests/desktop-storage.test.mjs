import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, rename, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopStore } from '../desktop/storage.mjs';
import { snapshot, restoreBackup, decodeBackup, automaticBackup } from '../desktop/backup.mjs';
import { demoCampaign, uid, createEntry } from '../app/domain.js';
import { defaultProfile } from '../app/assistant.js';
import { noteFile } from '../desktop/files.mjs';
import { DatabaseSync } from 'node:sqlite';
async function fixture(fn) {const root=await mkdtemp(join(tmpdir(),'dmw-native-'));let store=await DesktopStore.open(root);try{await fn(store,root);}finally{try{store.close();}catch{}await rm(root,{recursive:true,force:true});}}

test('desktop SQLite survives restart with Markdown notes, chat, profile and audio on disk',()=>fixture(async(store,root)=>{
  const c=demoCampaign(),assetId=uid(),trackId=uid(),data=new Uint8Array([1,2,3,4]);
  c.soundboard.tracks.push({id:trackId,assetId,name:'Фон',fileName:'фон.wav',kind:'music',mime:'audio/wav',bytes:4,volume:0.5,loop:true});
  const saved=await store.saveCampaign(c,{insert:true,assets:[{id:assetId,campaignId:c.id,mime:'audio/wav',data}]});
  await store.saveProfile({...defaultProfile(),instructions:'Мрачные загадки.'});
  assert.match(await readFile(join(root,'campaigns',c.id,'notes','Персонажи','Мира Вейл.md'),'utf8'),/Хозяйка/);
  store.close();const restored=await DesktopStore.open(root);
  try{const bundle=await restored.loadCampaignBundle(c.id);assert.equal(bundle.campaign.revision,saved.revision);assert.deepEqual(bundle.assets[0].data,data);assert.equal((await restored.loadProfile()).instructions,'Мрачные загадки.');}finally{restored.close();}
}));
test('Obsidian edits, moves, additions and deletions reconcile without losing identity or backlinks',()=>fixture(async(store,root)=>{
  const c=await store.saveCampaign(demoCampaign(),{insert:true}),mira=c.entries[0],prefix=join(root,'campaigns',c.id,'notes');
  c.entries[2].text='[[Мира Вейл|хозяйка]]';await store.saveCampaign(c);
  await mkdir(join(prefix,'Гавань'));await rename(join(prefix,'Персонажи','Мира Вейл.md'),join(prefix,'Гавань','Мира.md'));
  await writeFile(join(prefix,'Гавань','Мира.md'),noteFile({...mira,text:'Новый факт из Obsidian.'}));
  await writeFile(join(prefix,'Новый след.md'),'# След\n\n[[Гавань/Мира]]');
  const updated=(await store.listCampaigns())[0];
  assert.equal(updated.entries.find(e=>e.id===mira.id).name,'Мира');assert.equal(updated.entries.find(e=>e.id===mira.id).text,'Новый факт из Obsidian.');
  assert.match(updated.entries[2].text,/\[\[Гавань\/Мира\|хозяйка\]\]/);assert.equal(updated.entries.length,4);
  await rm(join(prefix,'Гавань','Мира.md'));
  const after=(await store.listCampaigns())[0];assert.equal(after.entries.length,3);assert.ok(!after.entries[1].links.includes(mira.id));
  assert.ok(store.db.prepare('SELECT count(*) AS count FROM history').get().count>=3);
}));
test('stale UI cannot overwrite external edits and duplicate Markdown IDs are rejected',()=>fixture(async(store,root)=>{
  const old=await store.saveCampaign(demoCampaign(),{insert:true}),e=old.entries[0],file=join(root,'campaigns',old.id,'notes','Персонажи','Мира Вейл.md');
  await writeFile(file,noteFile({...e,text:'Внешняя правка'}));old.entries[0].text='Устаревшая правка';
  await assert.rejects(()=>store.saveCampaign(old),/Obsidian/);
  assert.match(await readFile(file,'utf8'),/Внешняя правка/);
  await writeFile(join(root,'campaigns',old.id,'notes','Дубль.md'),noteFile(e));
  await assert.rejects(()=>store.listCampaigns(),/Повторяется dmw-id/);
}));
test('SQLite write journal recovers unfinished Markdown writes after a restart',()=>fixture(async(store,root)=>{
  let c=await store.saveCampaign(demoCampaign(),{insert:true});const flush=store.flush.bind(store);let calls=0;
  store.flush=async()=>{if(++calls>=3)throw new Error('Имитированный отказ диска');return flush();};
  c.entries[0].text='Сохранено перед отключением';c=await store.saveCampaign(c);
  assert.match(store.warning,/SQLite/);assert.ok(store.db.prepare('SELECT count(*) AS n FROM pending').get().n>0);
  store.close();const next=await DesktopStore.open(root);
  try{assert.equal((await next.listCampaigns())[0].entries[0].text,'Сохранено перед отключением');assert.equal(next.db.prepare('SELECT count(*) AS n FROM pending').get().n,0);}finally{next.close();}
}));
test('complete desktop backup restores campaigns, audio and remapped memory into a new library',()=>fixture(async(store,root)=>{
  const c=demoCampaign(),assetId=uid();c.soundboard.tracks.push({id:uid(),assetId,name:'Музыка',fileName:'x.wav',mime:'audio/wav',bytes:4,kind:'music',loop:true,volume:.5});
  await store.saveCampaign(c,{insert:true,assets:[{id:assetId,campaignId:c.id,mime:'audio/wav',data:new Uint8Array([4,3,2,1])}]});
  await store.saveProfile({...defaultProfile(),instructions:'Сказки'});
  await mkdir(join(root,'memory','campaigns',c.id),{recursive:true});await mkdir(join(root,'memory','shared'),{recursive:true});
  await writeFile(join(root,'memory','campaigns',c.id,'Факт.md'),'Пароль маяка');await writeFile(join(root,'memory','shared','Стиль.md'),'Короткие сцены');
  const backup=await snapshot(store),decoded=decodeBackup(backup);assert.equal(decoded.bundles.length,1);
  const restoredRoot=await restoreBackup(backup,root),restored=await DesktopStore.open(restoredRoot);
  try{const copy=(await restored.listCampaigns())[0];assert.notEqual(copy.id,c.id);assert.equal(copy.name,c.name);assert.equal((await restored.getAsset(copy.soundboard.tracks[0].assetId,copy.id)).data[0],4);assert.equal((await restored.loadProfile()).instructions,'Сказки');assert.equal(await readFile(join(restoredRoot,'memory','campaigns',copy.id,'Факт.md'),'utf8'),'Пароль маяка');assert.equal(await readFile(join(restoredRoot,'memory','shared','Стиль.md'),'utf8'),'Короткие сцены');}finally{restored.close();}
  await automaticBackup(store);await automaticBackup(store);
  assert.throws(()=>decodeBackup(Buffer.from('broken')),/Повреждённый/);
}));
test('failed campaign insert leaves no orphan audio, and deleting audio moves it to trash',()=>fixture(async(store,root)=>{
  const c=demoCampaign(),assetId=uid(),data=new Uint8Array([1,2,3,4]);
  c.soundboard.tracks.push({id:uid(),assetId,name:'Фон',fileName:'x.wav',kind:'music',mime:'audio/wav',bytes:4,volume:.5,loop:true});
  const asset={id:assetId,campaignId:c.id,mime:'audio/wav',data};
  const original=c.entries[1].id;c.entries[1].id=c.entries[0].id;
  await assert.rejects(()=>store.saveCampaign(c,{insert:true,assets:[asset]}));
  await assert.rejects(()=>readFile(join(root,'campaigns',c.id,'audio',assetId+'.wav')),/ENOENT/);
  c.entries[1].id=original;const saved=await store.saveCampaign(c,{insert:true,assets:[asset]});
  saved.soundboard.tracks=[];await store.saveCampaign(saved,{deleteAssets:[assetId]});
  await assert.rejects(()=>readFile(join(root,'campaigns',c.id,'audio',assetId+'.wav')),/ENOENT/);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM media').get().n,0);
}));
test('foreign and newer SQLite databases are rejected without changing schema version',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dmw-foreign-'));
  try{const db=new DatabaseSync(join(root,'workbench.sqlite'));db.exec('CREATE TABLE unrelated(id TEXT); PRAGMA user_version=9');db.close();
    await assert.rejects(()=>DesktopStore.open(root),/новой версией/);
    const again=new DatabaseSync(join(root,'workbench.sqlite'));assert.equal(again.prepare('PRAGMA user_version').get().user_version,9);again.exec('PRAGMA user_version=0');again.close();
    await assert.rejects(()=>DesktopStore.open(root),/не является/);
  }finally{await rm(root,{recursive:true,force:true});}
});
