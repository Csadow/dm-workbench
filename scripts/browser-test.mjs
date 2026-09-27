import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createAppServer } from './serve.mjs';

const temp = await mkdtemp(join(tmpdir(), 'dmw-browser-'));
const screenshots = process.env.SCREENSHOT_DIR || temp;
let assistantRequests = [], assistantMode = 'success';
const server = createAppServer({vaultRoot:join(temp,'vault'),fetchImpl:async(url,options={})=>{
  if(url.endsWith('/api/tags'))return Response.json({models:[{name:'qwen3.5:4b',size:3400000000,details:{format:'gguf'}}]});
  if(url.endsWith('/api/show'))return Response.json({details:{format:'gguf'},capabilities:['completion','thinking']});
  const body=JSON.parse(options.body);assistantRequests.push(body);
  if(assistantMode==='wait')await new Promise((resolve,reject)=>{if(options.signal.aborted)return reject(new Error('aborted'));options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
  if(assistantMode==='fail')return Response.json({error:'test failure'},{status:500});
  return Response.json({message:{content:'Предложение: Мира просит проверить свет у маяка. Дайте героям выбор — разговор или разведка. [К1]'},done:true});
}});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = spawn(process.env.CHROMIUM || 'chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${temp}/profile`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
browser.stderr.on('data', data => { stderr += data.toString(); });
let socket, session, targetId, sequence = 0;
const pending = new Map(), exceptions = [];
async function until(fn, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout: ${label}. ${last?.message || ''}`);
}
function command(method, params = {}, sid = session) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
  });
}
async function evaluate(expression, sid = session) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sid);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const click = async selector => {await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);if(selector==='[data-action="campaigns"]')await until(()=>evaluate("!!document.querySelector('.campaign-grid')"),'campaign list rendered');};
const setValue = (selector, value) => evaluate(`(() => {const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles:true})); })()`);
const waitText = text => until(() => evaluate(`document.body.textContent.includes(${JSON.stringify(text)})`), text);
async function submit() {
  await evaluate("document.querySelector('#edit-form').requestSubmit()");
  await until(() => evaluate("!document.querySelector('#editor').open"), 'dialog saved');
}
async function newPage(offline = false) {
  const target = await command('Target.createTarget', { url: 'about:blank' }, null);
  targetId = target.targetId;
  session = (await command('Target.attachToTarget', { targetId, flatten: true }, null)).sessionId;
  await command('Runtime.enable'); await command('Page.enable'); await command('Network.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  if (offline) await command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await command('Page.navigate', { url });
  await waitText('Мастерская историй');
  await until(() => evaluate("!!document.querySelector('[data-action=demo], .campaign-card')"), 'app loaded');
}
async function screenshot(name) {
  const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(screenshots, name), Buffer.from(result.data, 'base64'));
}
async function upload(path, selector = '#import-file') {
  const { root } = await command('DOM.getDocument');
  const { nodeId } = await command('DOM.querySelector', { nodeId: root.nodeId, selector });
  await command('DOM.setFileInputFiles', { nodeId, files: [path] });
}
try {
  const devtools = await until(async () => (await readFile(join(temp, 'profile/DevToolsActivePort'), 'utf8')).split('\n'), 'Chromium start');
  socket = new WebSocket(`ws://127.0.0.1:${devtools[0]}${devtools[1]}`);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    const request = pending.get(message.id);
    if (request) { clearTimeout(request.timer); pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result); }
  };
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: temp }, null);
  await newPage();
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
  const selectTheme=async value=>{
    await evaluate(`(()=>{const select=document.querySelector('[data-theme-choice]');select.value='${value}';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(()=>evaluate(`workbenchTheme.preference==='${value}'`),'theme '+value);
    await new Promise(resolve=>setTimeout(resolve,180)); // Let existing button hover transitions settle before screenshots.
  };
  await selectTheme('system');
  for(const value of ['light','dark']){
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value}]});
    await until(()=>evaluate(`document.documentElement.dataset.theme==='${value}'`),'system theme '+value);
  }
  await selectTheme('dark');
  await screenshot('dmw-welcome.png');
  await click('[data-action="demo"]'); await waitText('Тайны Тихой гавани');
  await until(() => evaluate("!!document.querySelector('[data-action=go-combat]')"), 'demo overview');
  await screenshot('dmw-overview.png');
  await click('[data-action="go-combat"]'); await click('[data-action="start-battle"]');
  await until(() => evaluate("!!document.querySelector('.current')"), 'battle started');
  await click('.current [data-action="damage"]');
  await setValue('[name="amount"]', '5'); await submit();
  let records = await evaluate("(async()=> (await import('./app/storage.js')).listCampaigns())()");
  const original = records[0]; assert.equal(original.battle.combatants[0].hp, 19);
  await click('[data-action="next-turn"]');
  await until(() => evaluate("document.querySelector('.current h2').textContent === 'Страж маяка'"), 'next combatant');
  await screenshot('dmw-combat.png');
  await click('[data-action="undo-battle"]');
  await until(() => evaluate("document.querySelector('.current h2').textContent === 'Путник'"), 'undo turn');
  // Inline arithmetic, timed reminders, and reusable encounters.
  await setValue('.current [data-hp-input]', '7');
  await setValue('.current [data-damage-scale]', '0.5');
  await click('.current [data-action="damage"]');
  await until(()=>evaluate("document.querySelector('.current .health strong').textContent==='16'"),'half damage rounded down');
  await click('[data-action="undo-battle"]');
  await until(()=>evaluate("document.querySelector('.current .health strong').textContent==='19'"),'undo inline damage');
  await click('.current [data-action="add-effect"]');
  await setValue('[name=name]','Ослепление'); await setValue('[name=rounds]','1'); await submit();
  await click('[data-action="next-turn"]'); await until(()=>evaluate("!document.body.classList.contains('saving')"),'turn saved');
  await click('[data-action="next-turn"]'); await until(()=>evaluate("!!document.querySelector('.effect-chip.expired')"),'effect expiry');
  await click('[data-action="previous-turn"]'); await until(()=>evaluate("!document.querySelector('.effect-chip.expired')"),'effect previous round');
  await click('[data-action="previous-turn"]'); await until(()=>evaluate("document.querySelector('.current h2').textContent==='Путник'"),'return turn');
  await click('[data-action="save-encounter"]'); await setValue('[name=name]','Засада у маяка'); await submit();
  await waitText('Засада у маяка');
  await click('[data-view="bestiary"]');
  await until(()=>evaluate("document.querySelectorAll('.monster-row').length===330"),'official catalogue loaded');
  await setValue('#monster-search','гоблин');
  assert.equal(await evaluate("document.querySelectorAll('.monster-row').length"),5);
  await click('[data-action="monster"][data-id="goblin-warrior"]');
  assert.equal(await evaluate("document.querySelector('#monster-reader').textContent.includes('Nimble Escape')"),true);
  await setValue('#monster-quantity','2');await click('[data-action="monster-to-combat"]');await waitText('Добавлено в бой: 2');
  await screenshot('dmw-bestiary.png');
  await click('[data-view="combat"]');assert.equal(await evaluate("document.querySelectorAll('.combatant').length"),4);
  await click('[data-action="undo-battle"]');await until(()=>evaluate("document.querySelectorAll('.combatant').length===3"),'undo second monster');
  await click('[data-action="undo-battle"]');await until(()=>evaluate("document.querySelectorAll('.combatant').length===2"),'undo first monster');
  await click('[data-view="knowledge"]');
  await click('.entry-card');
  assert.equal(await evaluate("!!document.querySelector('#entry-reader h2')"),true);
  await click('[data-action="pin-entry"]'); await waitText('★ Закреплено');
  const miraId=original.entries[0].id;
  await click(`[data-action="entry"][data-id="${miraId}"]`);
  await click('[data-action="edit-entry"]'); await setValue('[name=ac]','17'); await setValue('[name=maxHp]','35'); await setValue('[name=role]','ally'); await submit();
  // Inline Markdown, drafts across navigation, wiki links and backlinks.
  await click('[data-action="note-mode"]');
  const noteText=await evaluate("document.querySelector('#note-text').value");
  await setValue('#note-text',noteText+'\n\n## След\n\nПуть ведёт к [[Старый маяк|маяку]]. **Проверить следы.**');
  await click('[data-view="sessions"]');await click('[data-view="knowledge"]');
  assert.match(await evaluate("document.querySelector('#note-text').value"),/Проверить следы/);
  await evaluate("window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function() { this.transaction.abort(); }");
  await click('[data-action="note-save"]');await waitText('Не удалось сохранить');
  assert.match(await evaluate("document.querySelector('#note-text').value"),/Проверить следы/);
  await evaluate("IDBObjectStore.prototype.put = window.originalPut");
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'s',code:'KeyS',modifiers:2});
  await waitText('Заметка сохранена');await click('[data-action="note-mode"]');
  assert.equal(await evaluate("document.querySelector('.markdown-body strong').textContent"),'Проверить следы.');
  await click('.wiki-link');assert.equal(await evaluate("document.querySelector('.document-title').textContent"),'Старый маяк');
  assert.match(await evaluate("document.querySelector('.vault-inspector').textContent"),/Мира Вейл/);
  await click('[data-action="edit-entry"]');await setValue('[name=folder]','Мир/Побережье');await submit();
  await click(`[data-action="entry"][data-id="${miraId}"]`);
  assert.match(await evaluate("document.querySelector('.markdown-body').textContent"),/маяку/);
  assert.equal(await evaluate("document.querySelector('.wiki-link').dataset.action"),'entry');
  await screenshot('dmw-knowledge.png');
  await selectTheme('light');await screenshot('dmw-knowledge-light.png');await selectTheme('dark');
  await command('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
  await screenshot('dmw-knowledge-laptop.png');
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await click('[data-action="entry-to-combat"]'); await waitText('Участник добавлен в бой');
  await click('[data-view="combat"]');
  assert.equal(await evaluate("document.querySelectorAll('.combatant').length"),3);
  await click('[data-action="undo-battle"]'); await until(()=>evaluate("document.querySelectorAll('.combatant').length===2"),'undo creature copy');
  await click('[data-view="knowledge"]');
  await click('[data-action="new-entry"]');
  await setValue('[name="name"]', 'Письмо <img src=x onerror=alert(1)>');
  await setValue('[name="text"]', 'Секретная записка под камнем');
  await evaluate("document.querySelector('[name=links]').click()"); await submit();
  await setValue('#search', 'под камнем');
  assert.equal(await evaluate("document.querySelectorAll('.entry-card').length"), 1);
  assert.equal(await evaluate("document.querySelectorAll('.entry-card img').length"), 0);
  // A rejected storage transaction keeps the editor and the committed data intact.
  await click('[data-action="new-entry"]'); await setValue('[name="name"]', 'Черновик после ошибки');
  await evaluate("window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function() { this.transaction.abort(); }");
  await evaluate("document.querySelector('#edit-form').requestSubmit()");
  await until(() => evaluate("!!document.querySelector('#form-error').textContent"), 'storage error shown');
  assert.equal(await evaluate("document.querySelector('#editor').open"), true);
  assert.equal(await evaluate("document.querySelector('[name=name]').value"), 'Черновик после ошибки');
  assert.equal(await evaluate("(async()=> (await (await import('./app/storage.js')).listCampaigns())[0].entries.length)()"), 4);
  await evaluate("IDBObjectStore.prototype.put = window.originalPut"); await submit();
  await click('[data-view="sessions"]'); await click('[data-action="new-session"]');
  await setValue('[name="name"]', 'Встреча у пирса');
  await setValue('[name="plan"]', 'Найти владельца письма.');
  await setValue('[name="recap"]', 'Письмо написала Мира.');
  await setValue('[name="status"]', 'playing'); await submit();
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2 });
  assert.equal(await evaluate('document.activeElement.id'), 'search');
  await click('[data-view="journal"]'); await click('[data-action="new-event"]');
  await setValue('[name="text"]', 'Герои нашли письмо.'); await submit();
  assert.equal(await evaluate("document.body.textContent.includes('Герои нашли письмо.')"), true);
  // Local assistant UI uses a deterministic local test engine. Real model smoke
  // testing is separate, to keep CI independent of GPU hardware and downloads.
  await click('[data-view="assistant"]');await waitText('На устройстве: qwen3.5:4b');
  await click('[data-action="ai-settings"]');await setValue('[name=instructions]','Предпочитаю короткие сцены и переговоры.');await submit();
  await click('[data-action="vault-new"]');await setValue('[name=scope]','shared');await setValue('[name=path]','Мой стиль.md');await setValue('[name=text]','# Мой стиль\n\nПредпочитаю выбор из трёх возможностей.');await submit();
  await writeFile(join(temp,'vault','shared','Мой стиль.md'),'# Мой стиль\n\nМЕТКА_OBSIDIAN: заканчивай ответ вопросом игрокам.');
  await setValue('#ai-prompt','Что можно предложить Мире?');
  await evaluate("document.querySelector('#ai-form').requestSubmit()");
  await until(()=>evaluate("document.querySelectorAll('.chat-message.assistant').length===1 && !document.querySelector('[data-action=ai-cancel]')"),'assistant reply saved');
  assert.match(assistantRequests[0].messages[0].content,/короткие сцены и переговоры/);
  assert.match(assistantRequests[0].messages[0].content,/Мира Вейл/);
  assert.match(assistantRequests[0].messages[0].content,/МЕТКА_OBSIDIAN/);
  const journals=await readdir(join(temp,'vault','campaigns',original.id,'journal'));
  assert.equal(journals.length,1);assert.match(await readFile(join(temp,'vault','campaigns',original.id,'journal',journals[0]),'utf8'),/Дайте героям выбор/);
  // A simultaneous external edit leaves the in-app draft and disk version intact.
  await click('[data-action="vault-edit"]');await setValue('[name=text]','Несохранённая правка приложения');
  await writeFile(join(temp,'vault','shared','Мой стиль.md'),'МЕТКА_OBSIDIAN: свежая правка в другом редакторе.');
  await evaluate("document.querySelector('#edit-form').requestSubmit()");
  await until(()=>evaluate("document.querySelector('#form-error').textContent.includes('Файл изменён')"),'file conflict shown');
  assert.equal(await evaluate("document.querySelector('[name=text]').value"),'Несохранённая правка приложения');
  await evaluate("window.confirm=()=>true");await click('[data-action="close"]');
  await click('[data-action="ai-like"]');await waitText('Пример сохранён в памяти стиля');
  await screenshot('dmw-assistant.png');
  await setValue('#ai-prompt','Продолжи с учётом моего стиля.');await evaluate("document.querySelector('#ai-form').requestSubmit()");
  await until(()=>evaluate("document.querySelectorAll('.chat-message.assistant').length===2 && !document.querySelector('[data-action=ai-cancel]')"),'second assistant reply');
  assert.match(assistantRequests[1].messages[0].content,/Удачный ответ, одобренный мастером/);
  assistantMode='fail';await setValue('#ai-prompt','Запрос при ошибке');await evaluate("document.querySelector('#ai-form').requestSubmit()");
  await until(()=>evaluate("!!document.querySelector('#ai-error')?.textContent"),'assistant error visible');
  assert.equal(await evaluate("document.querySelector('#ai-prompt').value"),'Запрос при ошибке');
  assistantMode='wait';await setValue('#ai-prompt','Остановленный запрос');await evaluate("document.querySelector('#ai-form').requestSubmit()");
  await until(()=>assistantRequests.length===4,'pending generation');await click('[data-action="ai-cancel"]');await waitText('Запрос остановлен.');assistantMode='success';
  // Real PCM audio, native browser playback, mixing and scene recall.
  const wav=Buffer.alloc(44+8000*2*2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28);
  wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
  for(let i=0;i<(wav.length-44)/2;i++) wav.writeInt16LE(Math.round(Math.sin(i/8000*Math.PI*2*220)*1000),44+i*2);
  const audioPath=join(temp,'tone.wav'); await writeFile(audioPath,wav);
  await click('[data-view="sound"]');
  for(const [name,kind] of [['Ночной лес','ambience'],['Путешествие','music'],['Гром','effect']]) {
    await click('[data-action="new-sound"]'); await setValue('[name=name]',name); await setValue('[name=kind]',kind);
    if(kind==='effect') await click('[name=loop]');
    await upload(audioPath,'[name=audio]'); await submit();
  }
  const sound=await evaluate("(async()=> (await (await import('./app/storage.js')).listCampaigns())[0].soundboard)()");
  const music=sound.tracks.find(t=>t.kind==='music'), ambience=sound.tracks.find(t=>t.kind==='ambience'), effect=sound.tracks.find(t=>t.kind==='effect');
  for(const track of [music,ambience]) await click(`[data-track-card="${track.id}"] [data-action="play-sound"]`);
  await until(()=>evaluate("Array.from(document.querySelectorAll('audio')).filter(a=>!a.paused && a.currentTime>0.1).length===2"),'two native audio layers advancing');
  await setValue('[data-volume="master"]','50');
  await evaluate("document.querySelector('[data-volume=master]').dispatchEvent(new Event('change',{bubbles:true}))");
  await until(()=>evaluate("!document.body.classList.contains('saving')"),'master saved');
  assert.equal(await evaluate("Array.from(document.querySelectorAll('audio')).filter(a=>!a.paused).every(a=>Math.abs(a.volume-.35)<.001)"),true);
  await click('[data-action="save-mood"]'); await setValue('[name=name]','Лесная дорога'); await submit();
  await screenshot('dmw-sound.png');
  await click('[data-view="combat"]');
  assert.equal(await evaluate("Array.from(document.querySelectorAll('audio')).filter(a=>!a.paused).length"),2);
  await click(`.audio-dock [data-action="play-sound"][data-id="${effect.id}"]`);
  await until(()=>evaluate("Array.from(document.querySelectorAll('audio')).filter(a=>!a.paused).length===3"),'one shot plays with music');
  await until(()=>evaluate("Array.from(document.querySelectorAll('audio')).filter(a=>!a.paused).length===2"),'one shot ends without stopping music');
  await click('[data-action="stop-audio"]');
  assert.equal(await evaluate("Array.from(document.querySelectorAll('audio')).every(a=>a.paused)"),true);
  await click('[data-view="sound"]'); await click('[data-action="play-mood"]');
  await until(()=>evaluate("Array.from(document.querySelectorAll('audio')).filter(a=>!a.paused).length===2"),'scene recalled');
  await click('[data-action="export"]');
  const filename = await until(async () => (await readdir(temp)).find(p => p.endsWith('.dmw.json')), 'export download');
  const exported = JSON.parse(await readFile(join(temp, filename), 'utf8'));
  assert.equal(exported.campaign.sessions.length, 2);
  assert.equal(exported.campaign.assistant.messages.filter(m=>m.role==='assistant').length,2);
  assert.equal(exported.assets.length,3); assert.equal(exported.campaign.encounters.length,1);
  assert.equal(Buffer.from(exported.assets[0].base64,'base64').length,wav.length);
  assert.equal(exported.campaign.entries.length, 5); assert.equal(exported.campaign.events.length, 2);
  await click('[data-action="campaigns"]'); assert.equal(await evaluate("Array.from(document.querySelectorAll('audio')).every(a=>a.paused)"),true); await click('[data-action="new-campaign"]');
  await setValue('[name="name"]', 'Вторая кампания'); await submit();
  await click('[data-view="knowledge"]'); assert.equal(await evaluate("document.querySelectorAll('.entry-card').length"), 0);
  await upload(join(temp, filename)); await waitText('Кампания импортирована как отдельная копия');
  records = await evaluate("(async()=> (await import('./app/storage.js')).listCampaigns())()");
  assert.equal(records.length, 3);
  const copy = records.find(c => c.name.endsWith('— копия'));
  assert.equal(copy.soundboard.tracks.length,3);
  assert.notEqual(copy.soundboard.tracks[0].assetId,sound.tracks[0].assetId);
  assert.notEqual(copy.id, original.id); assert.equal(copy.battle.combatants[0].hp, 19); assert.equal(copy.entries.length, 5);
  const invalid = join(temp, 'invalid.json'); await writeFile(invalid, '{"application":"dm-workbench","formatVersion":999}');
  await upload(invalid); await waitText('версия формата не поддерживается');
  assert.equal(await evaluate("(async()=> (await (await import('./app/storage.js')).listCampaigns()).length)()"), 3);
  // Two concurrent editors cannot silently overwrite a newer revision.
  assert.equal(await evaluate(`(async()=> {const db=await import('./app/storage.js');const a=(await db.listCampaigns()).find(c=>c.name==='Вторая кампания');const b=structuredClone(a);a.summary='Первое изменение';await db.saveCampaign(a);try{b.summary='Устаревшее изменение';await db.saveCampaign(b);return false;}catch(e){return e.message.includes('другой вкладке');}})()`), true);
  await until(() => evaluate("!!navigator.serviceWorker.controller"), 'service worker controls page');
  const installability = await command('Page.getInstallabilityErrors');
  assert.deepEqual(installability.installabilityErrors, [], 'PWA installation requirements');
  // Stop the origin, close the tab, and open a fresh one offline in the same browser profile.
  await new Promise(resolve => server.close(resolve));
  await command('Target.closeTarget', { targetId }, null);
  await newPage(true);
  assert.equal(await evaluate("document.querySelectorAll('.campaign-card').length"), 3);
  await click(`[data-action="open"][data-id="${copy.id}"]`);
  await click('[data-view="bestiary"]');await until(()=>evaluate("document.querySelectorAll('.monster-row').length===330"),'catalogue available offline');
  await click('[data-view="assistant"]');await until(()=>evaluate("document.querySelector('#ai-connection').textContent.includes('недоступен')"),'assistant unavailable without local server');
  assert.equal(await evaluate("document.querySelectorAll('.chat-message.assistant').length"),2);
  assert.equal(await evaluate("document.querySelector('.style-panel').textContent.includes('короткие сцены и переговоры')"),true);
  await click('[data-view="sound"]');
  assert.equal(await evaluate("Array.from(document.querySelectorAll('audio')).length"),0,'no autoplay after cold start');
  await click('[data-action="play-mood"]');
  await until(()=>evaluate("Array.from(document.querySelectorAll('audio')).filter(a=>!a.paused && a.currentTime>0.1).length===2"),'imported audio plays offline');
  await click('[data-action="campaigns"]');
  await click(`[data-action="open"][data-id="${original.id}"]`);
  await click('[data-view="combat"]');
  assert.equal(await evaluate("document.querySelector('.current h2').textContent"), 'Путник');
  assert.equal(await evaluate("document.querySelector('.current .health strong').textContent"), '19');
  await click('[data-action="next-turn"]');
  await until(() => evaluate("document.querySelector('.current h2').textContent === 'Страж маяка'"), 'offline mutation');
  await command('Page.reload'); await until(() => evaluate("!!document.querySelector('.campaign-card')"), 'offline reload');
  await click(`[data-action="open"][data-id="${original.id}"]`); await click('[data-view="combat"]');
  assert.equal(await evaluate("document.querySelector('.current h2').textContent"), 'Страж маяка');
  await command('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await screenshot('dmw-laptop.png');
  await click('[data-view="knowledge"]');await click(`[data-action="entry"][data-id="${miraId}"]`);
  assert.equal(await evaluate("!!document.querySelector('.wiki-link')"),true);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
  await screenshot('dmw-knowledge-small.png');
  await click('[data-action="campaigns"]');
  await click(`[data-action="archive"][data-id="${original.id}"]`);
  await until(() => evaluate("document.querySelector('.archive')?.textContent.includes('Тайны Тихой гавани')"), 'archive saved');
  // Upgrade a real version-one IndexedDB in the isolated test profile.
  const legacy=structuredClone(original); delete legacy.schemaVersion; delete legacy.soundboard; delete legacy.encounters;
  for(const entry of legacy.entries) {delete entry.stats; delete entry.pinned;}
  for(const state of [legacy.battle,...legacy.battle.history]) for(const p of state.combatants) for(const key of ['ac','role','initiativeBonus','effects','notes']) delete p[key];
  await evaluate(`(async()=>{(await (await import('./app/storage.js')).openDatabase()).close(); await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('dm-workbench');r.onsuccess=resolve;r.onerror=()=>reject(r.error);}); await new Promise((resolve,reject)=>{const r=indexedDB.open('dm-workbench',1);r.onupgradeneeded=()=>r.result.createObjectStore('campaigns',{keyPath:'id'});r.onsuccess=()=>{const db=r.result,tx=db.transaction('campaigns','readwrite');tx.objectStore('campaigns').put(${JSON.stringify(legacy)});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});})()`);
  await command('Page.reload'); await until(()=>evaluate("document.querySelectorAll('.campaign-card').length===1"),'legacy database upgrade');
  await click(`[data-action="open"][data-id="${legacy.id}"]`); await click('[data-view="combat"]');
  assert.equal(await evaluate("document.querySelector('.current .health strong').textContent"),'19');
  await click('[data-action="next-turn"]'); await until(()=>evaluate("!document.body.classList.contains('saving')"),'migrated save');
  assert.equal(await evaluate("(async()=> (await (await import('./app/storage.js')).openDatabase()).version)()"),3);
  assert.deepEqual(exceptions, []);
  console.log('PASS: Markdown editor/draft recovery/wiki rename/backlinks/offline, live Obsidian memory/journal/conflicts, official offline bestiary, assistant context/style/history/errors/cancel, audio playback/mixing/scenes/offline restore, IDB v1 upgrade, timed effects, inline damage, creature transfer, encounter backups, UI creation, isolated campaigns, search/XSS, combat/undo, sessions/journal, keyboard search, failed-write recovery, real export/import, invalid import, concurrent writes, cold offline launch with origin stopped, offline persistence, archive, 1024px layout.');
  console.log(`Screenshots: ${screenshots}`);
} catch (error) {
  console.error(error);
  try { console.error(await evaluate("({toast:document.querySelector('#toast')?.textContent, players:Array.from(document.querySelectorAll('audio')).map(a=>({paused:a.paused,time:a.currentTime,error:a.error?.message,ready:a.readyState,src:a.src})),activation:navigator.userActivation.hasBeenActive})")); } catch {}
  console.error(stderr.slice(-2000)); process.exitCode = 1;
} finally {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  socket?.close(); browser.kill('SIGTERM'); server.close();
  await new Promise(resolve => browser.exitCode !== null ? resolve() : browser.once('exit', resolve));
  if (process.env.KEEP_BROWSER_DATA !== '1') await rm(join(temp, 'profile'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
