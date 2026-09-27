import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCampaign, createEntry } from '../app/domain.js';
import { markdown, resolveWiki, noteLinks, renameWikiLinks, validFolder, entryMarkdown } from '../app/markdown.js';
import { exportCampaign, importCampaign } from '../app/backup.js';
import { buildRequest, defaultProfile } from '../app/assistant.js';
import { createAppServer } from '../scripts/serve.mjs';

test('Markdown safely renders wiki links and code; ambiguous names require a folder',()=>{
  const c=createCampaign('Мир'),a=createEntry('npc','Мира'),b=createEntry('note','Мира'),note=createEntry('note','Письмо');
  a.folder='Мир/Люди';c.entries.push(a,b,note);
  note.text='# Тайна\n\n[[Мир/Люди/Мира|хозяйка]] и [[Мира]]\n\n`[[Письмо]]`\n\n```md\n[[Письмо]]\n```\n\n<img src=x onerror=alert(1)>\n\n[атака](javascript:alert(1))\n\n- **Первый**\n- *Второй*';
  assert.equal(resolveWiki(c.entries,'Мира'),null);
  assert.equal(resolveWiki(c.entries,'Мир/Люди/Мира.md#Цель'),a);
  assert.deepEqual(noteLinks(c,note),[a.id]);
  const html=markdown(note.text,c.entries);
  assert.match(html,/<h1>Тайна<\/h1>/);assert.match(html,/<strong>Первый<\/strong>/);
  assert.match(html,/class="wiki-link unresolved"/);assert.match(html,/&lt;img/);
  assert.ok(!html.includes('<img'));assert.ok(!html.includes('href="javascript:'));
  assert.equal((html.match(/data-action="entry"/g)||[]).length,1);
  assert.match(html,/<code>\[\[Письмо\]\]<\/code>/);
});
test('renaming and moving notes updates resolved wiki references, preserves aliases and survives backup',()=>{
  const c=createCampaign('Мир'),a=createEntry('npc','Мира'),b=createEntry('note','Письмо','[[Мира|хозяйка]] [[Персонажи/Мира#Цель]] `[[Мира]]`');
  a.text='[[Мира]]';c.entries.push(a,b);
  const updated={...a,name:'Мира Вейл',folder:'Люди/Гавань'};renameWikiLinks(c,a,updated);c.entries[0]=updated;
  assert.match(b.text,/\[\[Люди\/Гавань\/Мира Вейл\|хозяйка\]\]/);
  assert.match(b.text,/\[\[Люди\/Гавань\/Мира Вейл#Цель\]\]/);
  assert.ok(b.text.endsWith('`[[Мира]]`'));assert.equal(updated.text,'[[Люди/Гавань/Мира Вейл]]');
  const copy=importCampaign(exportCampaign(c));assert.equal(copy.entries[0].folder,'Люди/Гавань');
  assert.deepEqual(noteLinks(copy,copy.entries[1]),[copy.entries[0].id]);
  assert.match(entryMarkdown(c,updated),/^---\nid:/);
  for(const bad of ['../Люди','Люди//Мир','/absolute','Мир\\Люди'])assert.equal(validFolder(bad),false);
});
test('Markdown memory fits the request budget and labels past suggestions separately from facts',()=>{
  const c=createCampaign('Гавань'),files=[
    {scope:'shared',path:'Стиль.md',text:'Короткие ответы. Люблю переговоры.',modified:'2026-09-27'},
    {scope:'campaign',path:'journal/one.md',text:'Мира: предложение сцены с драконом.',modified:'2026-09-27'},
    {scope:'campaign',path:'irrelevant.md',text:'СОВСЕМ ДРУГОЙ МАТЕРИАЛ',modified:'2026-09-27'}
  ];
  const request=buildRequest(c,defaultProfile(),'Что помнишь про Миру?',null,files);
  assert.match(request.messages[0].content,/Люблю переговоры/);
  assert.match(request.messages[0].content,/Разговор \(предложения, не факты мира\)/);
  assert.ok(!request.messages[0].content.includes('СОВСЕМ ДРУГОЙ МАТЕРИАЛ'));
  assert.ok(request.sources.some(s=>s.includes('Стиль.md')));
});
test('file memory reads external edits, isolates campaigns and protects concurrent edits and paths',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'dmw-memory-')),root=join(temp,'memory');
  const server=createAppServer({vaultRoot:root});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const request=(method,data,campaign='alpha',headers={})=>fetch(`${origin}/api/memory${method==='GET'?'':'/file'}?campaign=${campaign}`,{method,headers:{Origin:origin,...(data?{'Content-Type':'application/json'}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})});
  try {
    const note={scope:'shared',path:'Стиль.md',text:'# Стиль\n\nКороткие описания.',revision:null};
    let response=await request('PUT',note);assert.equal(response.status,200);const first=await response.json();
    assert.equal(await readFile(join(root,'shared','Стиль.md'),'utf8'),note.text);
    assert.equal((await request('PUT',note)).status,409);
    await request('PUT',{scope:'campaign',path:'Мир/Тайна.md',text:'Секрет альфы',revision:null});
    await request('PUT',{scope:'campaign',path:'Тайна.md',text:'Секрет беты',revision:null},'beta');
    let index=await (await request('GET')).json();assert.equal(index.files.length,2);assert.ok(!JSON.stringify(index).includes('Секрет беты'));
    await writeFile(join(root,'shared','Стиль.md'),'Отредактировано в Obsidian.');
    index=await (await request('GET')).json();assert.ok(index.files.some(f=>f.text==='Отредактировано в Obsidian.'));
    assert.equal((await request('PUT',{...note,text:'Устаревшая правка',revision:first.revision})).status,409);
    const latest=index.files.find(f=>f.scope==='shared');
    const writes=await Promise.all([request('PUT',{...latest,text:'Вариант один'}),request('PUT',{...latest,text:'Вариант два'})]);
    assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
    for(const path of ['../escape.md','/tmp/escape.md','nested/../../escape.md','file.txt'])assert.equal((await request('PUT',{...note,path})).status,400);
    assert.equal((await request('PUT',note,'alpha',{Origin:'https://evil.example'})).status,403);
    assert.equal((await request('GET',null,'alpha',{'Sec-Fetch-Site':'cross-site'})).status,403);
    assert.equal((await request('PUT',{...note,path:'big.md',text:'字'.repeat(30000)})).status,400);
    await mkdir(join(temp,'outside'));await symlink(join(temp,'outside'),join(root,'shared','escape'));
    assert.equal((await request('PUT',{...note,path:'escape/no.md'})).status,400);
    await symlink(join(root,'shared','Стиль.md'),join(root,'shared','link.md'));
    assert.equal((await request('PUT',{...note,path:'link.md'})).status,400);
    assert.equal((await fetch(origin+'/vault/memory/shared/Стиль.md')).status,404);
    index=await (await request('GET')).json();
    const current=index.files.find(f=>f.path==='Стиль.md');
    assert.equal((await request('DELETE',{...current,revision:first.revision})).status,409);
    assert.equal((await request('DELETE',current)).status,200);
    assert.ok(!(await (await request('GET')).json()).files.some(f=>f.path==='Стиль.md'));
  }finally{await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
});
