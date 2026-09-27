import { mkdir, lstat, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const digest = value => createHash('sha256').update(value).digest('hex');
export function safeRelative(path) {
  if(typeof path!=='string'||!path||path.length>700||isAbsolute(path)||path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f:]/.test(p))||path.includes('\\'))throw new Error('Недопустимый путь файла.');
  return path;
}
export async function inside(root,path,{parents=false}={}) {
  safeRelative(path);let current=resolve(root);
  const base=await lstat(current);if(!base.isDirectory()||base.isSymbolicLink())throw new Error('Хранилище должно быть обычной папкой.');
  const parts=path.split('/');
  for(const [i,part] of parts.entries()) {
    current=join(current,part);
    if(parents&&i<parts.length-1)await mkdir(current,{recursive:true,mode:0o700});
    try{const stat=await lstat(current);if(stat.isSymbolicLink())throw new Error('Символические ссылки в хранилище не поддерживаются.');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return current;
}
export async function bytes(root,path,max=100000000) {
  const full=await inside(root,path);let stat;
  try{stat=await lstat(full);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!stat.isFile()||stat.size>max)throw new Error(`Файл отсутствует или превышает лимит: ${path}`);
  const data=await readFile(full);if(data.length>max)throw new Error('Файл вырос во время чтения.');return data;
}
export async function atomic(root,path,data) {
  const full=await inside(root,path,{parents:true}),tmp=join(dirname(full),'.dmw-'+randomUUID()+'.tmp');
  try{await writeFile(tmp,data,{flag:'wx',mode:0o600,flush:true});await rename(tmp,full);}
  finally{await rm(tmp,{force:true});}
}
export async function walk(root,base,maxFiles=12000,maxBytes=25000000) {
  const found=[];let total=0;
  async function visit(path,depth) {
    if(depth>12)throw new Error('Слишком много вложенных папок.');
    const full=await inside(root,path);let list;
    try{list=await readdir(full,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const e of list) {
      if(e.name.startsWith('.'))continue;
      if(e.isSymbolicLink())throw new Error(`Уберите символическую ссылку из хранилища: ${path}/${e.name}`);
      if(e.isDirectory())await visit(path+'/'+e.name,depth+1);
      else if(e.isFile()&&e.name.endsWith('.md')) {
        const name=path+'/'+e.name,data=await bytes(root,name,500000);
        if(!data)continue;total+=data.length;
        if(found.length>=maxFiles||total>maxBytes)throw new Error('Markdown-файлы превышают лимит хранилища.');
        found.push({path:name,text:data.toString('utf8'),hash:digest(data)});
      }
    }
  }
  await visit(base,0);return found;
}
export const slug = name => name.normalize('NFC').replace(/[\\/<>:"|?*\x00-\x1f\[\]#]/g,'_').replace(/^\.+|[. ]+$/g,'').slice(0,90)||'Заметка';
export function noteFile(e) {
  // IDs in frontmatter keep identity stable when Obsidian renames the file.
  return `---\ndmw-id: ${e.id}\n---\n${e.text}`;
}
export function parseNote(text) {
  const match=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if(!match)return {id:null,text};
  const id=match[1].match(/^dmw-id:\s*["']?([a-zA-Z0-9_-]{1,100})["']?\s*$/m)?.[1]||null;
  // Preserve unrelated frontmatter instead of silently throwing user properties away.
  const other=match[1].split(/\r?\n/).filter(l=>!/^dmw-id:/.test(l));
  return {id,text:(other.some(l=>l.trim())?`---\n${other.join('\n')}\n---\n`:'')+text.slice(match[0].length)};
}
