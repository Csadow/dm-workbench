import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createAppServer } from './serve.mjs';

const temp = await mkdtemp(join(tmpdir(), 'dmw-browser-'));
const screenshots = process.env.SCREENSHOT_DIR || temp;
const server = createAppServer();
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
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
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
async function upload(path) {
  const { root } = await command('DOM.getDocument');
  const { nodeId } = await command('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
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
  await click('[data-action="export"]');
  const filename = await until(async () => (await readdir(temp)).find(p => p.endsWith('.dmw.json')), 'export download');
  const exported = JSON.parse(await readFile(join(temp, filename), 'utf8'));
  assert.equal(exported.campaign.sessions.length, 2);
  assert.equal(exported.campaign.entries.length, 5); assert.equal(exported.campaign.events.length, 2);
  await click('[data-action="campaigns"]'); await click('[data-action="new-campaign"]');
  await setValue('[name="name"]', 'Вторая кампания'); await submit();
  await click('[data-view="knowledge"]'); assert.equal(await evaluate("document.querySelectorAll('.entry-card').length"), 0);
  await upload(join(temp, filename)); await waitText('Кампания импортирована как отдельная копия');
  records = await evaluate("(async()=> (await import('./app/storage.js')).listCampaigns())()");
  assert.equal(records.length, 3);
  const copy = records.find(c => c.name.endsWith('— копия'));
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
  await click('[data-action="campaigns"]');
  await click(`[data-action="archive"][data-id="${original.id}"]`);
  await until(() => evaluate("document.querySelector('.archive')?.textContent.includes('Тайны Тихой гавани')"), 'archive saved');
  assert.deepEqual(exceptions, []);
  console.log('PASS: UI creation, isolated campaigns, search/XSS, combat/undo, sessions/journal, keyboard search, failed-write recovery, real export/import, invalid import, concurrent writes, cold offline launch with origin stopped, offline persistence, archive, 1024px layout.');
  console.log(`Screenshots: ${screenshots}`);
} catch (error) {
  console.error(error); console.error(stderr.slice(-2000)); process.exitCode = 1;
} finally {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  socket?.close(); browser.kill('SIGTERM'); server.close();
  await new Promise(resolve => browser.exitCode !== null ? resolve() : browser.once('exit', resolve));
  if (process.env.KEEP_BROWSER_DATA !== '1') await rm(join(temp, 'profile'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
