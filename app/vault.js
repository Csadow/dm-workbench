import { esc, button } from './ui.js';
const states=new Map();
export const memoryKey = f => f.scope+':'+f.path;
export function memoryState(id) {
  if(!states.has(id))states.set(id,{files:[],root:'',loaded:false,error:'',pending:[]});
  return states.get(id);
}
async function request(id,method='GET',data) {
  let response;
  try{response=await fetch(`./api/memory${method==='GET'?'':'/file'}?campaign=${encodeURIComponent(id)}`,{method,cache:'no-store',signal:AbortSignal.timeout(10000),...(data?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});}
  catch{throw new Error('Markdown-память недоступна. Запустите локальный сервер приложения.');}
  let result;try{result=await response.json();}catch{throw new Error('Обновите локальный сервер: node scripts/start-local.mjs.');}
  if(!response.ok)throw new Error(result.error||'Не удалось открыть Markdown-память.');
  return result;
}
export async function readMemory(id) {
  const state=memoryState(id);
  try {const data=await request(id);state.files=data.files;state.root=data.root;state.loaded=true;state.error='';return data.files;}
  catch(error){state.error=error.message;throw error;}
}
export async function writeMemory(id,file) { const result=await request(id,'PUT',file);const state=memoryState(id);state.files=[{...result,modified:new Date().toISOString()},...state.files.filter(f=>f.scope!==file.scope||f.path!==file.path)];await readMemory(id).catch(()=>{});return result; }
export async function deleteMemory(id,file) { await request(id,'DELETE',file);const state=memoryState(id);state.files=state.files.filter(f=>f.scope!==file.scope||f.path!==file.path);await readMemory(id).catch(()=>{}); }
export async function rememberConversation(id,question,answer) {
  const state=memoryState(id);
  const file={scope:'campaign',path:`journal/${answer.createdAt.slice(0,10)}-${answer.id}.md`,revision:null,text:`# Разговор с помощником\n\nДата: ${answer.createdAt}\nМодель: ${answer.model}\n\n> История разговора, не подтверждённые события мира. Предложения ИИ требуют проверки мастером.\n\n## Мастер\n\n${question}\n\n## Помощник\n\n${answer.text}\n`};
  if(!state.pending.some(f=>f.path===file.path))state.pending.push(file);
  await retryMemory(id);
}
export async function retryMemory(id) {
  const state=memoryState(id);
  for(const file of [...state.pending]) {
    try {
      // An interrupted response may have committed the file already.
      const files=await readMemory(id),existing=files.find(f=>f.scope===file.scope&&f.path===file.path);
      if(existing?.text!==file.text)await writeMemory(id,file);
      state.pending=state.pending.filter(f=>f.path!==file.path);
    }catch(error){state.error='Ответ сохранён в переписке, но файл памяти не записан: '+error.message;return;}
  }
}
export function memoryPanel(id) {
  const state=memoryState(id),curated=state.files.filter(f=>!f.path.startsWith('journal/')),journals=state.files.length-curated.length;
  return `<section class="panel markdown-memory"><div class="section-title"><h2>Markdown-память</h2>${button('vault-new','+ Запись','secondary')}</div><p class="muted tiny">Помощник перечитывает файлы перед каждым ответом. Разговоры пополняют память этой кампании автоматически; идеи ИИ остаются предложениями.</p><div class="actions">${button('vault-refresh','Обновить из папки','quiet')}${button('vault-journal',`Разговоры: ${journals}`,'quiet')}</div>${state.loaded?`<details><summary>Открыть в Obsidian и сохранить копию</summary><p class="tiny">В Obsidian выбери «Открыть папку как хранилище» и укажи:</p><code class="vault-path">${esc(state.root)}</code><p class="tiny muted">shared/ — общий стиль. campaigns/${esc(id)}/ — память этой кампании. Новые .md-файлы в этих папках тоже читаются. Для резервной копии скопируй всю папку: в JSON кампании она не входит.</p></details>`:''}<div class="memory-files">${curated.map((f,i)=>`<button class="list-item" data-action="vault-edit" data-id="${esc(memoryKey(f))}"><span><strong>${esc(f.path)}</strong><small>${f.scope==='shared'?'Общая память':'Эта кампания'}</small></span><span>↗</span></button>`).join('')||'<p class="muted tiny">Добавь предпочтения или факты, которые стоит помнить между разговорами.</p>'}</div><p class="memory-error" role="status">${esc(state.error)}</p>${state.pending.length?button('vault-retry','Повторить запись разговоров','secondary'):''}</section>`;
}
