import { esc } from './ui.js';

const FOLDERS = {npc:'Персонажи',location:'Места',faction:'Фракции',hook:'Сюжет',item:'Предметы',note:'Заметки',monster:'Существа',spell:'Заклинания',rule:'Правила'};
export const noteFolder = entry => entry.folder ?? FOLDERS[entry.type] ?? 'Заметки';
export function validFolder(folder) {
  return typeof folder === 'string' && folder.length <= 200 && (folder === '' || folder.split('/').every(p => p.trim() === p && p.length && !['.','..'].includes(p) && !/[\\\x00-\x1f<>:"|?*]/.test(p)));
}
export const notePath = e => (noteFolder(e) ? noteFolder(e)+'/' : '') + e.name;
const normalized = text => text.normalize('NFC').toLocaleLowerCase('ru');
export function resolveWiki(entries, target) {
  const name = normalized(target.split('#')[0].replace(/\.md$/i,'').trim());
  const exact = entries.filter(e => normalized(notePath(e)) === name);
  if(exact.length === 1) return exact[0];
  const matches = entries.filter(e => normalized(e.name) === name);
  return matches.length === 1 ? matches[0] : null;
}
// Both rendering and link indexing ignore code. Raw HTML is always escaped.
export function mapWiki(text, fn) {
  return text.replace(/```[^\n]*\n[\s\S]*?(?:```|$)|`[^`\n]+`|\[\[([^\]\n]{1,500})\]\]/g, (whole, inner) => inner ? fn(inner, whole) : whole);
}
export function noteLinks(c, e) {
  const ids = new Set(e.links);
  mapWiki(e.text, inner => { const target = resolveWiki(c.entries, inner.split('|')[0]); if(target) ids.add(target.id); return ''; });
  return [...ids].filter(id => c.entries.some(x => x.id === id));
}
export function renameWikiLinks(c, old, updated) {
  if(notePath(old) === notePath(updated))return;
  const rewrite = (inner, whole) => {
    const [target, ...alias] = inner.split('|');
    if(resolveWiki(c.entries, target)?.id !== old.id)return whole;
    const anchor = target.includes('#') ? '#'+target.split('#').slice(1).join('#') : '';
    return `[[${notePath(updated)}${anchor}${alias.length ? '|'+alias.join('|') : ''}]]`;
  };
  updated.text=mapWiki(updated.text,rewrite);
  for(const e of c.entries)e.text=mapWiki(e.text,rewrite);
}
function inline(text, entries) {
  const pattern = /`([^`\n]+)`|\[\[([^\]\n]{1,500})\]\]|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let html='', start=0;
  for(const m of text.matchAll(pattern)) {
    html+=esc(text.slice(start,m.index)); start=m.index+m[0].length;
    if(m[1])html+=`<code>${esc(m[1])}</code>`;
    else if(m[2]) {
      const [target,...label]=m[2].split('|'), entry=resolveWiki(entries,target);
      html+=`<button class="wiki-link ${entry?'':'unresolved'}" data-action="${entry?'entry':'wiki-create'}" ${entry?`data-id="${entry.id}"`:`data-name="${esc(target.split('#')[0])}"`}>${esc(label.join('|')||target)}</button>`;
    } else if(m[3])html+=`<a href="${esc(m[4])}" target="_blank" rel="noopener noreferrer">${esc(m[3])}</a>`;
    else if(m[5])html+=`<strong>${esc(m[5])}</strong>`;
    else html+=`<em>${esc(m[6])}</em>`;
  }
  return html+esc(text.slice(start));
}
export function markdown(text, entries=[]) {
  const lines=text.replace(/\r\n/g,'\n').split('\n'); let html='',list='',code=null,paragraph=[];
  const flush=()=>{if(paragraph.length){html+=`<p>${paragraph.map(l=>inline(l,entries)).join('<br>')}</p>`;paragraph=[];}if(list){html+=`</${list}>`;list='';}};
  for(const line of lines) {
    if(line.startsWith('```')) {flush();if(code===null)code=[];else{html+=`<pre><code>${esc(code.join('\n'))}</code></pre>`;code=null;}continue;}
    if(code!==null){code.push(line);continue;}
    const heading=line.match(/^(#{1,6})\s+(.+)$/),item=line.match(/^\s*(?:([-*])|\d+\.)\s+(.+)$/);
    if(heading){flush();html+=`<h${heading[1].length}>${inline(heading[2],entries)}</h${heading[1].length}>`;}
    else if(item){if(paragraph.length)flush();const type=item[1]?'ul':'ol';if(list!==type){flush();list=type;html+=`<${list}>`;}html+=`<li>${inline(item[2],entries)}</li>`;}
    else if(/^>\s?/.test(line)){flush();html+=`<blockquote>${inline(line.replace(/^>\s?/,''),entries)}</blockquote>`;}
    else if(/^\s*---+\s*$/.test(line)){flush();html+='<hr>';}
    else if(!line.trim())flush();
    else{if(list)flush();paragraph.push(line);}
  }
  flush();if(code!==null)html+=`<pre><code>${esc(code.join('\n'))}</code></pre>`;
  return html;
}
export function entryMarkdown(c,e) {
  const properties={id:e.id,type:e.type,tags:e.tags,aliases:[e.name]};
  return `---\n${Object.entries(properties).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n# ${e.name}\n\n${e.text}\n\n${e.links.length?'## Связи\n'+e.links.map(id=>c.entries.find(x=>x.id===id)).filter(Boolean).map(x=>`- [[${notePath(x)}]]`).join('\n')+'\n':''}`;
}
