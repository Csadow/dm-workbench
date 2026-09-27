import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCampaign, migrateCampaign, changeBattle, createEncounter, fromEntry, effectRemaining, uid, d20 } from '../app/domain.js';
import { exportCampaign, importBundle, encodeAssets, validateCampaign } from '../app/backup.js';

function legacyCampaign() {
  const c = demoCampaign();
  c.battle = changeBattle(c.battle, {type:'start'});
  delete c.schemaVersion; delete c.encounters; delete c.soundboard;
  for (const e of c.entries) {delete e.stats; delete e.pinned;}
  for (const state of [c.battle,...c.battle.history]) for(const p of state.combatants) for(const key of ['ac','role','initiativeBonus','effects','notes']) delete p[key];
  return c;
}
test('version one backup and records migrate without changing original data or history', () => {
  const original=legacyCampaign(), snapshot=structuredClone(original), c=migrateCampaign(original);
  validateCampaign(c); assert.deepEqual(original,snapshot);
  assert.equal(c.battle.activeId,original.battle.activeId);
  assert.equal(c.battle.history.length,original.battle.history.length);
  const imported=importBundle(JSON.stringify({application:'dm-workbench',formatVersion:1,exportedAt:new Date().toISOString(),campaign:original}));
  assert.equal(imported.campaign.entries[0].name, original.entries[0].name);
  assert.deepEqual(imported.assets,[]); validateCampaign(imported.campaign);
});
test('timed effects survive undo, previous round, and backup with independent IDs', () => {
  const c=demoCampaign(); c.battle=changeBattle(c.battle,{type:'start'});
  const id=c.battle.activeId;
  c.battle=changeBattle(c.battle,{type:'effect-add',id,name:'Ослепление',rounds:1});
  const effect=c.battle.combatants[0].effects[0];
  assert.equal(effectRemaining(effect,1),1);
  c.battle=changeBattle(changeBattle(c.battle,{type:'next'}),{type:'next'});
  assert.equal(effectRemaining(effect,c.battle.round),0);
  const previous=changeBattle(c.battle,{type:'previous'});
  assert.equal(effectRemaining(previous.combatants[0].effects[0],previous.round),1);
  const copy=importBundle(exportCampaign(c)).campaign;
  assert.notEqual(copy.battle.combatants[0].effects[0].id,effect.id);
  assert.equal(copy.battle.history.at(-1).combatants[0].effects[0].id,copy.battle.combatants[0].effects[0].id);
  const removed=changeBattle(copy.battle,{type:'effect-remove',id:copy.battle.activeId,effectId:copy.battle.combatants[0].effects[0].id});
  assert.equal(removed.combatants[0].effects.length,0);
  assert.deepEqual(changeBattle(removed,{type:'undo'}),copy.battle);
});
test('creature instances and encounter loading preserve templates and protect active combat', () => {
  const c=demoCampaign(), entry=c.entries[0]; entry.stats={ac:17,maxHp:35,initiativeBonus:3,role:'ally',speed:'30 фт'};
  const p=fromEntry(entry), q=fromEntry(entry); assert.notEqual(p.id,q.id); assert.equal(p.ac,17); assert.equal(p.notes,entry.text);
  c.battle=changeBattle(c.battle,{type:'add',combatant:p});
  c.battle=changeBattle(c.battle,{type:'damage',id:p.id,amount:10});
  const template=createEncounter('Стража',c.battle); c.encounters.push(template);
  assert.equal(template.combatants.at(-1).hp,35);
  const loaded=changeBattle(c.battle,{type:'load',combatants:template.combatants});
  assert.equal(loaded.combatants.at(-1).hp,35); assert.notEqual(loaded.combatants.at(-1).id,template.combatants.at(-1).id);
  assert.deepEqual(changeBattle(loaded,{type:'undo'}),c.battle);
  assert.throws(()=>changeBattle(changeBattle(loaded,{type:'start'}),{type:'load',combatants:template.combatants}));
  validateCampaign(importBundle(exportCampaign(c)).campaign);
});
test('initiative rolls have valid ranges and sorting preserves the active participant', () => {
  for(let i=0;i<100;i++) assert.ok(d20()>=1 && d20()<=20);
  let b=changeBattle(demoCampaign().battle,{type:'start'}); const active=b.activeId;
  b=changeBattle(b,{type:'roll',values:{[b.combatants[1].id]:30}});
  b=changeBattle(b,{type:'sort'}); assert.equal(b.activeId,active); assert.equal(b.combatants[0].initiative,30);
});
test('audio backup includes bytes, remaps scenes and refuses missing or corrupt assets', async () => {
  const c=demoCampaign(), assetId=uid(), trackId=uid(), bytes=new Uint8Array([82,73,70,70,0,1,2,3]);
  c.soundboard.tracks.push({id:trackId,assetId,name:'Гром',fileName:'thunder.wav',kind:'effect',mime:'audio/wav',bytes:bytes.length,volume:.4,loop:false});
  c.soundboard.moods.push({id:uid(),name:'Гроза',layers:[{trackId,volume:.2}]});
  const assets=await encodeAssets([{id:assetId,campaignId:c.id,blob:new Blob([bytes],{type:'audio/wav'})}]);
  assert.throws(()=>exportCampaign(c));
  const source=exportCampaign(c,assets), copy=importBundle(source);
  assert.deepEqual(new Uint8Array(await copy.assets[0].blob.arrayBuffer()),bytes);
  assert.notEqual(copy.assets[0].id,assetId);
  assert.equal(copy.assets[0].campaignId,copy.campaign.id);
  assert.equal(copy.campaign.soundboard.tracks[0].assetId,copy.assets[0].id);
  assert.equal(copy.campaign.soundboard.moods[0].layers[0].trackId,copy.campaign.soundboard.tracks[0].id);
  for(const mutate of [x=>x.assets=[],x=>x.assets[0].base64='AAAA',x=>x.assets[0].mime='text/html',x=>x.campaign.soundboard.moods[0].layers[0].trackId='missing',x=>x.campaign.soundboard.masterVolume=2]) {
    const value=JSON.parse(source); mutate(value); assert.throws(()=>importBundle(JSON.stringify(value)));
  }
});
