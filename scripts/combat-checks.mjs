import assert from 'node:assert/strict';

// The same user flow runs in Chromium offline and in the packaged Electron app.
export async function combatChecks({evaluate,click,input,until,submit,screenshot=async()=>{}}) {
  const campaign=()=>evaluate("(async()=> (await (await import('./app/storage.js')).listCampaigns()).find(c=>c.name==='Боевой стенд'))()");
  await click('[data-action="campaigns"]');await until("!!document.querySelector('.campaign-grid')",'combat test campaigns');
  await click('[data-action="new-campaign"]');await input('[name=name]','Боевой стенд');await submit();
  await click('[data-view="combat"]');await click('[data-action="new-monster-template"]');
  await input('[name=name]','Ледяной дозорный');await input('[name=maxHp]','42');await input('[name=ac]','16');await input('[name=initiativeBonus]','3');
  await input('[name=dexScore]','16');await input('[name=dexSave]','6');await input('[name=conScore]','14');
  await input('[name=defenses]','Сопротивление холоду');await input('[name=text]','Защищает проход у маяка.');
  await click('[data-action="add-attack-field"]');
  await input('[data-attack-editor] [name$="-name"]','Ледяное копьё');await input('[data-attack-editor] [name$="-bonus"]','6');
  await input('[data-attack-editor] [name$="-damage"]','1d8 + 4');await input('[data-attack-editor] [name$="-range"]','10 футов');
  await input('[data-attack-editor] [name$="-notes"]','Колющий урон; при попадании замедляет цель.');
  await click('[data-action="add-attack-field"]');
  await input('[data-attack-editor]:last-child [name$="-name"]','Ледяное дыхание');await input('[data-attack-editor]:last-child [name$="-saveDc"]','14');
  await input('[data-attack-editor]:last-child [name$="-damage"]','2d6');
  await submit();await until("document.querySelectorAll('.monster-template').length===1",'custom template saved');
  await click('[data-action="template-to-combat"]');await input('[name=quantity]','2');await submit();
  await until("document.querySelectorAll('.combatant').length===2",'two independent instances');
  let c=await campaign();const first=c.battle.combatants[0].id,second=c.battle.combatants[1].id;
  const row=`[data-combatant="${first}"]`;
  assert.equal(c.entries[0].stats.combat.actions.length,2);
  await click('[data-action="new-player"]');await input('[name=name]','Элира');await input('[name=initiative]','18');await submit();
  c=await campaign();const player=c.battle.combatants.find(p=>p.role==='hero').id,playerRow=`[data-combatant="${player}"]`;
  assert.equal(await evaluate(`!!document.querySelector('${playerRow} .health')`),false,'player does not need an HP sheet');
  await click(`${playerRow} [data-action="add-effect"]`);await input('[name=name]','Отравлен');await input('[name=source]','Паук в проходе');await input('[name=reminder]','ТЕЛ СЛ 13 в конце хода');await input('[name=rounds]','2');await submit();
  await click(`${playerRow} [data-action="toggle-concentration"]`);await until(`document.querySelector('${playerRow} [aria-pressed]').getAttribute('aria-pressed')==='true'`,'player concentration visible');
  await click(`${row} [data-action="toggle-concentration"]`);await until(`document.querySelector('${row} [aria-pressed]').getAttribute('aria-pressed')==='true'`,'enemy concentration');
  await input(`${row} [data-hp-input]`,'27');await click(`${row} [data-action="damage"]`);
  await until(`document.querySelector('${row} .concentration-warning')?.textContent.includes('СЛ 13')`,'persistent concentration DC');
  c=await campaign();assert.equal(c.battle.combatants.find(p=>p.id===first).hp,15);assert.equal(c.battle.combatants.find(p=>p.id===second).hp,42);
  await click('[data-action="undo-battle"]');await until(`document.querySelector('${row} .health strong').textContent==='42'`,'damage undo');
  assert.equal(await evaluate(`!!document.querySelector('${row} .concentration-warning')`),false);
  await click(`${row} [data-action="inspect-combatant"]`);await click('[data-kind="attack"]');
  await input('[name=mode]','advantage');await input('[name=manual]','4 18');await input('[name=extra]','-2');await submit();
  await until("document.querySelector('.roll-result>b')?.textContent==='22'",'manual advantage calculation');
  await click('[data-kind="save"][data-key="dex"]');await input('[name=manual]','12');await submit();
  await until("document.querySelector('.roll-result>b')?.textContent==='18'",'printed save bonus');
  await click('[data-kind="damage"]');await input('[name=formula]','7');await submit();
  await click('[data-action="apply-roll-damage"]');await input('[name=target]',second);await input('[name=scale]','0.5');await submit();
  c=await campaign();assert.equal(c.battle.combatants.find(p=>p.id===second).hp,39,'half damage floors per target');
  await click('[data-action="edit-monster-template"]');await input('[data-attack-editor] [name$="-bonus"]','9');await submit();
  c=await campaign();assert.equal(c.entries[0].stats.combat.actions[0].bonus,9);assert.equal(c.battle.combatants[0].combat.actions[0].bonus,6);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await screenshot('dmw-combat-custom.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'combat fits viewport');
  // Actual reload verifies that state is not just retained by UI variables.
  await evaluate('location.reload()');await until("!!document.querySelector('.campaign-grid')",'combat reload');
  await click(`[data-action="open"][data-id="${c.id}"]`);await click('[data-view="combat"]');
  await until(`document.querySelector('${playerRow}')?.textContent.includes('ТЕЛ СЛ 13')`,'effect reminder survives reload');
  assert.equal(await evaluate(`document.querySelector('${playerRow} [aria-pressed]').getAttribute('aria-pressed')`),'true');
  assert.equal(await evaluate("document.querySelectorAll('.roll-result').length"),3);
  const restored=await evaluate(`(async()=>{const {exportCampaign,importBundle}=await import('./app/backup.js');const c=(await (await import('./app/storage.js')).listCampaigns()).find(c=>c.id==='${c.id}');return importBundle(exportCampaign(c)).campaign;})()`);
  assert.equal(restored.battle.combatants[2].effects[0].source,'Паук в проходе');assert.equal(restored.entries[0].stats.combat.actions[0].bonus,9);
  return c.id;
}
