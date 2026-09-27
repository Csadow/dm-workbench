import { combatChecks } from './combat-checks.mjs';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { demoCampaign } from '../app/domain.js';
import { exportCampaign } from '../app/backup.js';
import { snapshot, restoreBackup } from '../desktop/backup.mjs';
import { nativeTheme } from 'electron';
export async function runDesktopChecks({win,store,handlers,report}) {
  const evaluate=expression=>win.webContents.executeJavaScript(expression,true);
  async function until(expression,label) {const end=Date.now()+15000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timeout: '+label);}
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const input=(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  async function theme(value) {
    await evaluate(`(()=>{const select=document.querySelector('[data-theme-choice]');select.value='${value}';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`workbenchTheme.preference==='${value}'&&!document.querySelector('[data-theme-choice]').disabled`,'theme '+value);
    assert.equal(nativeTheme.themeSource,value);
  }
  try {
    await until("!!document.querySelector('.campaign-grid')",'desktop boot');
    assert.equal(await evaluate('typeof require'),'undefined');assert.equal(await evaluate('typeof process'),'undefined');
    assert.equal(await evaluate('!!globalThis.dmw.storage'),true);
    assert.equal(await evaluate('navigator.serviceWorker.controller === null'),true);
    if(process.env.DMW_TEST_PHASE==='restart') {
      assert.equal(await evaluate('document.documentElement.dataset.theme'),'light','appearance survives full restart');
      assert.equal(nativeTheme.themeSource,'light');
      const c=(await store.listCampaigns()).find(c=>c.name==='Тайны Тихой гавани');assert.ok(c);
      assert.equal(c.entries[0].text,'Внешний факт после Obsidian.');
      assert.equal(c.soundboard.tracks.length,1);
      await click(`[data-action="open"][data-id="${c.id}"]`);await click('[data-view="combat"]');
      assert.equal(await evaluate("document.querySelectorAll('.combatant').length"),2);
      const combat=(await store.listCampaigns()).find(c=>c.name==='Боевой стенд');assert.ok(combat);assert.equal(combat.entries[0].stats.combat.actions[0].bonus,9);assert.equal(combat.battle.combatants[2].effects[0].source,'Паук в проходе');
      await writeFile(report,JSON.stringify({ok:true,phase:'restart'}));return;
    }
    assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
    await theme('system');
    // Simulate OS changes through Electron, without touching the user's desktop settings.
    nativeTheme.themeSource='light';await until("document.documentElement.dataset.theme==='light'",'system light');
    nativeTheme.themeSource='dark';await until("document.documentElement.dataset.theme==='dark'",'system dark');
    await theme('dark');
    await click('[data-action="demo"]');await until("!!document.querySelector('[data-view=knowledge]')",'demo saved');
    let c=(await store.listCampaigns())[0];
    await click('[data-view="knowledge"]');await until("!!document.querySelector('[data-action=note-mode]')",'notes');
    await click(`[data-action="entry"][data-id="${c.entries[0].id}"]`);await click('[data-action="note-mode"]');
    await input('#note-text','Текст из настольного редактора.');
    await evaluate("globalThis.themeDraft=document.querySelector('#note-text');themeDraft.setSelectionRange(3,10)");
    await theme('light');
    assert.equal(await evaluate("themeDraft===document.querySelector('#note-text')&&themeDraft.selectionStart===3&&themeDraft.selectionEnd===10"),true,'switching theme keeps editor and selection');
    await theme('dark');await click('[data-action="note-save"]');
    await until("document.querySelector('#toast').textContent.includes('Заметка сохранена')",'native note save');
    const path=join(store.root,'campaigns',c.id,'notes','Персонажи','Мира Вейл.md');
    assert.match(await readFile(path,'utf8'),/настольного редактора/);
    await writeFile(path,`---\ndmw-id: ${c.entries[0].id}\n---\nВнешний факт после Obsidian.`);
    await click('[data-view="overview"]');await click('[data-view="knowledge"]');
    await until("document.querySelector('#note-text')?.value==='Внешний факт после Obsidian.'",'external note edit');
    // The browser export format imports through the actual file input.
    const legacy=exportCampaign(demoCampaign());
    await evaluate(`(()=>{const input=document.querySelector('#import-file');const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(legacy)}],'web.dmw.json',{type:'application/json'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until("document.querySelector('#toast').textContent.includes('Кампания импортирована')",'legacy import');
    assert.equal((await store.listCampaigns()).length,2);
    assert.ok(store.db.prepare('SELECT * FROM imports').get());
    await click('[data-action="campaigns"]');await until("!!document.querySelector('.campaign-grid')",'campaign list');
    await click(`[data-action="open"][data-id="${c.id}"]`);
    const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
    await click('[data-view="sound"]');await click('[data-action="new-sound"]');await input('[name=name]','Настольный звук');
    await evaluate(`(()=>{const input=document.querySelector('[name=audio]');const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob('${wav.toString('base64')}'),c=>c.charCodeAt(0))],'tone.wav',{type:'audio/wav'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#edit-form').requestSubmit();})()`);
    await until("!document.querySelector('#editor').open",'audio saved');
    await click('[data-action="play-sound"]');await until("Array.from(document.querySelectorAll('audio')).some(a=>!a.paused&&a.currentTime>0.1)",'native audio playback');
    await click('[data-action="stop-audio"]');
    await click('[data-view="assistant"]');await until("document.querySelector('#ai-connection').textContent.includes('qwen3.5')",'native assistant');
    await input('#ai-prompt','Помоги подготовить сцену.');await evaluate("document.querySelector('#ai-form').requestSubmit()");
    await until("document.querySelectorAll('.chat-message.assistant').length===1&&!document.querySelector('[data-action=ai-cancel]')",'native AI reply');
    assert.equal((await store.listCampaigns()).find(x=>x.id===c.id).assistant.messages.length,2);
    const backup=await snapshot(store);assert.ok(backup.length>0);
    const restored=await restoreBackup(backup,store.root);assert.ok(restored);
    await click('[data-action="help"]');await until("!!document.querySelector('[data-action=native-backup]')",'native settings');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const image=await win.webContents.capturePage();await writeFile(report+'.png',image.toPNG());
    await combatChecks({evaluate,click,input,until,submit:async()=>{await evaluate("document.querySelector('#edit-form').requestSubmit()");await until("!document.querySelector('#editor').open",'combat dialog saved');},screenshot:async()=>{const image=await win.webContents.capturePage();await writeFile('/tmp/dmw-desktop-combat.png',image.toPNG());}});
    await theme('light');
    await win.webContents.reload();await until("!!document.querySelector('.campaign-grid')",'theme reload');
    assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');
    assert.equal((await evaluate('indexedDB.databases()')).length,0,'campaigns never written to IndexedDB');
    await writeFile(report,JSON.stringify({ok:true,phase:'first',campaigns:3,backupBytes:backup.length}));
  }catch(error){await writeFile(report,JSON.stringify({ok:false,error:error.stack,body:await evaluate('document.body.innerText').catch(()=>''),}));throw error;}
}
