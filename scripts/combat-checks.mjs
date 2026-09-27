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
  await click(`${row} [data-action="inspect-combatant"]`);await click('[data-action="combat-roll"][data-kind="attack"]');
  await input('[name=mode]','advantage');await input('[name=manual]','4 18');await input('[name=extra]','-2');await submit();
  await until("document.querySelector('.roll-result>b')?.textContent==='22'",'manual advantage calculation');
  await click('[data-action="combat-roll"][data-kind="save"][data-key="dex"]');await input('[name=manual]','12');await submit();
  await until("document.querySelector('.roll-result>b')?.textContent==='18'",'printed save bonus');
  await click('[data-action="combat-roll"][data-kind="damage"]');await input('[name=formula]','7');await submit();
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
  // Add from the SRD before and during combat through the actual picker, without
  // leaving combat or resetting an existing participant's HP/conditions/turn.
  // Search accepts English display names (IDs use hyphens).
  await click('.page-heading [data-action="combat-library"]');await until("!!document.querySelector('#combat-monster-search')",'picker on populated preparation');
  await input('#combat-monster-search','Skeleton');await click('[data-action="pick-combat-monster"][data-id="skeleton"]');await submit();
  c=await campaign();assert.equal(c.battle.combatants.length,4);assert.equal(c.battle.started,false);
  await click('[data-action="undo-battle"]');await until("document.querySelectorAll('.combatant').length===3",'undo SRD addition in preparation');
  await click('[data-action="start-battle"]');await until("!!document.querySelector('[data-action=next-turn]')",'combat started');
  const before=(await campaign()).battle;
  await click('.page-heading [data-action="combat-library"]');await until("!!document.querySelector('#combat-monster-search')",'picker during combat');
  await input('#combat-monster-search','гоблин');
  await click('[data-action="pick-combat-monster"][data-id="goblin-warrior"]');await input('[name=quantity]','2');await submit();
  c=await campaign();assert.equal(c.battle.combatants.length,5);assert.equal(c.battle.activeId,before.activeId);assert.equal(c.battle.round,before.round);
  assert.deepEqual(c.battle.combatants.slice(0,3),before.combatants);
  const goblin=c.battle.combatants[3];
  assert.equal(await evaluate("document.querySelectorAll('.combat-inspector [data-kind=save][data-action=quick-combat-roll]').length"),6);
  const quick=async selector=>{
    const previous=(await campaign()).battle.rolls.at(-1)?.id;
    await click(selector);await until(`!!document.querySelector('.quick-roll-result') && document.querySelector('.quick-roll-result').dataset.roll!=='${previous}'`,'quick roll saved');
    await until("!document.body.classList.contains('saving')",'quick roll persistence');
    assert.equal(await evaluate("document.querySelector('#editor').open"),false,'quick roll needs no dialog');
    return (await campaign()).battle.rolls.at(-1);
  };
  const initiative=await quick('[data-action="quick-combat-roll"][data-kind="initiative"]');
  assert.ok(initiative.total>=3&&initiative.total<=22);assert.equal((await campaign()).battle.combatants.find(p=>p.id===goblin.id).initiative,initiative.total);
  for(const [key,bonus] of [['str',-1],['dex',2],['con',0],['int',0],['wis',-1],['cha',-1]]){
    const r=await quick(`[data-action="quick-combat-roll"][data-kind="save"][data-key="${key}"]`);assert.ok(r.total>=1+bonus&&r.total<=20+bonus);
  }
  const scroll=await evaluate("(()=>{const panel=document.querySelector('.combat-inspector');panel.scrollTop=180;return panel.scrollTop;})()");
  const hit=await quick('[data-action="quick-combat-roll"][data-kind="attack"]');assert.ok(hit.total>=5&&hit.total<=24);
  assert.equal(await evaluate("document.querySelector('.combat-inspector').scrollTop"),scroll,'quick rolls preserve card scroll');
  const damage=await quick('[data-action="quick-combat-roll"][data-kind="damage"]');assert.equal(damage.formula,'1d6+2');assert.ok(damage.total>=3&&damage.total<=8);
  assert.equal(await evaluate("!!document.querySelector('.conditional-damage [data-kind=damage]')"),true);
  await click('.conditional-damage [data-kind="damage"]');assert.equal(await evaluate("document.querySelector('[name=formula]').value"),'1d4');
  assert.match(await evaluate("document.querySelector('.damage-condition').textContent"),/Advantage/);await submit();
  assert.match((await campaign()).battle.rolls.at(-1).label,/дополнительный/);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await screenshot('dmw-combat-srd-rolls.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  return c.id;
}
