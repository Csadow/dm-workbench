import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultCombat, newAttack, parseDice, rollDamage, rollCheck, combatFromSRD } from '../app/combat.js';
import { createEntry, createCampaign, fromEntry, changeBattle, migrateCampaign, createEncounter } from '../app/domain.js';
import { exportCampaign, importBundle, validateCampaign } from '../app/backup.js';

test('bounded dice arithmetic, critical dice and physical d20 values are transparent',()=>{
  assert.deepEqual(rollDamage('2d6 + 1d4 + 3',{die:s=>s}),{total:19,detail:'[6, 6] +[4] +3',formula:'2d6 + 1d4 + 3'});
  assert.equal(rollDamage('2d6 + 3',{critical:true,die:()=>4}).total,19);
  assert.equal(rollDamage('1d4 - 6',{die:()=>1}).total,0);
  for(const f of ['','alert(1)','2d6;3','101d6','0d6','1d1','1d1001','999999999999999999','1d6++2'])assert.throws(()=>parseDice(f));
  assert.equal(rollCheck(5,{mode:'advantage',manual:'2 19',extra:-2}).total,22);
  assert.equal(rollCheck(5,{mode:'disadvantage',manual:'2,19'}).total,7);
  assert.equal(rollCheck(-1,{manual:'20'}).natural,20);
  for(const manual of ['0','21','1.5','2 3','abc'])assert.throws(()=>rollCheck(2,{manual}));
  assert.throws(()=>rollCheck(null));assert.throws(()=>rollCheck(2,{mode:'advantage',manual:'18'}));
});
test('custom monster copies, templates and encounters never share mutable combat data',()=>{
  const c=createCampaign('Мир'),e=createEntry('monster','Ледяной дозорный');
  e.stats.maxHp=42;e.stats.combat.actions.push({...newAttack(),name:'Копьё',bonus:6,damage:'1d8+4'});c.entries.push(e);
  const p=fromEntry(e),q=fromEntry(e);c.battle=changeBattle(c.battle,{type:'add-many',combatants:[p,q]});
  c.battle=changeBattle(c.battle,{type:'damage',id:p.id,amount:8});
  c.battle.combatants[0].combat.actions[0].bonus=10;
  assert.equal(q.hp,42);assert.equal(c.battle.combatants[1].hp,42);assert.equal(e.stats.combat.actions[0].bonus,6);
  assert.equal(c.battle.combatants[1].combat.actions[0].bonus,6);
  c.encounters.push(createEncounter('Дозор',c.battle));
  const copy=importBundle(exportCampaign(c)).campaign;validateCampaign(copy);
  assert.equal(copy.entries[0].stats.combat.actions[0].damage,'1d8+4');assert.notEqual(copy.battle.combatants[0].id,p.id);
  const loaded=changeBattle(copy.battle,{type:'load',combatants:copy.encounters[0].combatants});assert.equal(loaded.combatants[0].hp,42);
});
test('concentration reminders retain every damage event, absorb temporary HP and undo together',()=>{
  const c=createCampaign('Мир'),p=fromEntry(createEntry('monster','Маг'));p.concentration=true;p.tempHp=30;
  c.battle=changeBattle(c.battle,{type:'add',combatant:p});const before=structuredClone(c.battle);
  c.battle=changeBattle(c.battle,{type:'damage',id:p.id,amount:27});
  assert.equal(c.battle.combatants[0].hp,10);assert.equal(c.battle.combatants[0].tempHp,3);
  assert.deepEqual(c.battle.combatants[0].concentrationChecks,[13]);assert.deepEqual(changeBattle(c.battle,{type:'undo'}),before);
  for(const amount of [1,100])c.battle=changeBattle(c.battle,{type:'damage',id:p.id,amount});
  assert.deepEqual(c.battle.combatants[0].concentrationChecks,[13,10,30]);
  c.battle=changeBattle(c.battle,{type:'edit',id:p.id,values:{concentration:false}});assert.deepEqual(c.battle.combatants[0].concentrationChecks,[]);
});
test('version 3 campaign migration preserves notes, history and conditions through a version 4 backup',()=>{
  const c=createCampaign('Старая кампания'),e=createEntry('monster','Существо');c.entries.push(e);
  c.battle=changeBattle(c.battle,{type:'add',combatant:fromEntry(e)});const id=c.battle.combatants[0].id;
  c.battle=changeBattle(c.battle,{type:'effect-add',id,name:'Отравлен',rounds:2,source:'Паук',reminder:'ТЕЛ 13 в конце хода'});
  c.encounters.push(createEncounter('Встреча',c.battle));c.schemaVersion=3;
  for(const e of c.entries)delete e.stats.combat;
  for(const state of [c.battle,...c.battle.history,...c.encounters]){delete state.rolls;for(const p of state.combatants){for(const k of ['combat','speed','trackHp','concentrationChecks'])delete p[k];for(const e of p.effects){delete e.source;delete e.reminder;}}}
  const snapshot=structuredClone(c),upgraded=migrateCampaign(c);assert.deepEqual(c,snapshot);validateCampaign(upgraded);
  assert.equal(upgraded.battle.combatants[0].effects[0].name,'Отравлен');assert.equal(upgraded.battle.combatants[0].trackHp,true);
  const copy=importBundle(JSON.stringify({application:'dm-workbench',formatVersion:3,exportedAt:new Date().toISOString(),campaign:c})).campaign;
  assert.equal(copy.schemaVersion,4);assert.equal(copy.battle.history.length,c.battle.history.length);
  assert.throws(()=>migrateCampaign({...c,schemaVersion:99}));
});
test('SRD extraction preserves printed save bonuses and leaves conditional damage unrolled',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../assets/srd-monsters.json',import.meta.url)));
  for(const m of catalog.monsters){const c=createCampaign(m.name),e=createEntry('monster',m.name,m.text);e.stats.combat=combatFromSRD(m.text);c.entries=[e];validateCampaign(c);}
  const block=id=>combatFromSRD(catalog.monsters.find(m=>m.id===id).text);
  assert.equal(block('aboleth').abilities.dex.save,3);assert.equal(block('aboleth').abilities.dex.score,9);
  assert.equal(block('goblin-warrior').actions[0].bonus,4);assert.equal(block('goblin-warrior').actions[0].damage,'');
  assert.equal(block('ankheg').actions.find(a=>a.name.startsWith('Acid Spray')).saveDc,12);
  assert.equal(block('ankheg').actions.find(a=>a.name.startsWith('Acid Spray')).damage,'4d6');
  assert.equal(block('young-white-dragon').abilities.int.save,null,'unsigned ambiguous extracted value is not invented');
});
test('combat imports reject malformed profiles and effect reminders without changing originals',()=>{
  const c=createCampaign('Мир'),e=createEntry('monster','Маг');e.stats.combat=defaultCombat();c.entries=[e];
  c.battle=changeBattle(c.battle,{type:'add',combatant:fromEntry(e)});
  const text=exportCampaign(c);
  for(const change of [c=>c.entries[0].stats.combat.abilities.str.score=99,c=>c.battle.combatants[0].trackHp='no',c=>c.battle.combatants[0].concentrationChecks=[100]]){
    const data=JSON.parse(text);change(data.campaign);assert.throws(()=>importBundle(JSON.stringify(data)));
  }
});
