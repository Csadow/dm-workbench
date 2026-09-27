import { mkdir, lstat, readdir, open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, parse } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT=fileURLToPath(new URL('../vault/memory/',import.meta.url));
const MAX_FILE=80000,MAX_FILES=512,MAX_TOTAL=20000000;
const hash=text=>createHash('sha256').update(text).digest('hex');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const reply=(res,status,data)=>res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(data));
function localRequest(req) {
  const host=req.headers.host||'',origin=req.headers.origin;
  let hostname;try{hostname=new URL('http://'+host).hostname;}catch{}
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && ['localhost','127.0.0.1','[::1]'].includes(hostname) && (!origin||origin==='http://'+host) && (req.method==='GET'||!!origin) && req.headers['sec-fetch-site']!=='cross-site';
}
function filePath(value) {
  if(typeof value!=='string'||value.length>240||!value.endsWith('.md')||value.split('/').length>5||value.split('/').some(p=>!p||p.startsWith('.')||p.trim()!==p||/[\\\x00-\x1f<>:"|?*]/.test(p)))throw fail('Неверное имя Markdown-файла.');
  return value;
}
async function jsonBody(req) {
  if(req.headers['content-type']?.split(';')[0]!=='application/json')throw fail('Требуется JSON.');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>150000)throw fail('Запрос слишком большой.');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('Неверный JSON.');}
}
export function createMemoryHandler({vaultRoot=DEFAULT_ROOT}={}) {
  const root=resolve(vaultRoot),locks=new Map();
  async function directory(parts,create=false) {
    let path=parse(root).root;
    for(const part of [...root.slice(path.length).split(/[\\/]/).filter(Boolean),...parts]) {
      if(part)path=join(path,part);
      if(create)await mkdir(path,{recursive:true,mode:0o700});
      const stat=await lstat(path);
      if(stat.isSymbolicLink()||!stat.isDirectory())throw fail('Папка памяти не может быть символической ссылкой.');
    }
    return path;
  }
  async function read(path) {
    let handle;
    try {
      const before=await lstat(path);if(before.isSymbolicLink()||!before.isFile())throw fail('Память не может быть символической ссылкой.');
      handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_FILE)throw fail('Файл памяти должен быть обычным Markdown-файлом до 80 КБ.');
      const text=await handle.readFile('utf8');if(Buffer.byteLength(text)>MAX_FILE)throw fail('Файл памяти больше 80 КБ.');
      return {text,revision:hash(text),modified:stat.mtime.toISOString()};
    }catch(error){if(error.code==='ENOENT')return null;throw error;}finally{await handle?.close();}
  }
  async function files(scope) {
    const result=[];let bytes=0;
    async function walk(parts,relative='') {
      let path;try{path=await directory(parts);}catch(error){if(error.code==='ENOENT')return;throw error;}
      for(const entry of await readdir(path,{withFileTypes:true})) {
        if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
        const name=relative+entry.name;
        if(entry.isDirectory()&&name.split('/').length<5)await walk([...parts,entry.name],name+'/');
        else if(entry.isFile()&&entry.name.endsWith('.md')) {
          filePath(name);const data=await read(join(path,entry.name));if(!data)continue;
          bytes+=Buffer.byteLength(data.text);if(result.length>=MAX_FILES||bytes>MAX_TOTAL)throw fail('Слишком много файлов памяти: до 512 файлов и 20 МБ на область. Перенесите старые записи из хранилища.');
          result.push({scope:scope[0]==='shared'?'shared':'campaign',path:name,...data});
        }
      }
    }
    await walk(scope);return result;
  }
  return async (req,res,url) => {
    if(!url.pathname.startsWith('/api/memory'))return false;
    if(!localRequest(req)){reply(res,403,{error:'Память доступна только из локального приложения.'});return true;}
    try {
      const campaignId=url.searchParams.get('campaign');
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(campaignId||''))throw fail('Укажите кампанию.');
      if(url.pathname==='/api/memory'&&req.method==='GET') {
        await directory(['shared'],true);await directory(['campaigns',campaignId],true);
        const [shared,campaign]=await Promise.all([files(['shared']),files(['campaigns',campaignId])]);
        reply(res,200,{root,files:[...shared,...campaign].sort((a,b)=>b.modified.localeCompare(a.modified))});return true;
      }
      if(url.pathname!=='/api/memory/file'||!['PUT','DELETE'].includes(req.method))throw fail('Неизвестный запрос памяти.',404);
      const data=await jsonBody(req);if(!data||typeof data!=='object'||!['shared','campaign'].includes(data.scope))throw fail('Неверная область памяти.');
      const relative=filePath(data.path),parts=[...(data.scope==='shared'?['shared']:['campaigns',campaignId]),...relative.split('/')],name=parts.pop();
      if(data.revision!==null&&(typeof data.revision!=='string'||!/^[a-f0-9]{64}$/.test(data.revision)))throw fail('Неверная версия файла.');
      if(req.method==='PUT'&&(typeof data.text!=='string'||Buffer.byteLength(data.text)>MAX_FILE))throw fail('Память должна быть текстом до 80 КБ.');
      const key='vault',previous=locks.get(key)||Promise.resolve();
      const operation=previous.catch(()=>{}).then(async()=>{
        const parent=await directory(parts,true),path=join(parent,name),current=await read(path);
        if((current?.revision??null)!==data.revision)throw fail('Файл изменён в Obsidian или другой вкладке. Скопируйте свой текст и откройте файл заново, чтобы сравнить версии.',409);
        if(req.method==='DELETE'){if(current)await unlink(path);return {deleted:true};}
        const existing=await files(data.scope==='shared'?['shared']:['campaigns',campaignId]);
        if((!current&&existing.length>=MAX_FILES)||existing.reduce((n,f)=>n+Buffer.byteLength(f.text),0)-Buffer.byteLength(current?.text||'')+Buffer.byteLength(data.text)>MAX_TOTAL)throw fail('Область памяти заполнена. Перенесите старые записи из хранилища.');
        const temporary=join(parent,'.'+randomUUID()+'.tmp');
        try {
          const handle=await open(temporary,'wx',0o600);
          try{await handle.writeFile(data.text,'utf8');await handle.sync();}finally{await handle.close();}
          await rename(temporary,path);
        }finally{await unlink(temporary).catch(()=>{});}
        return {scope:data.scope,path:relative,text:data.text,revision:hash(data.text)};
      });
      locks.set(key,operation);
      try{reply(res,200,await operation);}finally{if(locks.get(key)===operation)locks.delete(key);}
    }catch(error){reply(res,error.status||500,{error:error.status?error.message:'Не удалось прочитать или сохранить локальную память. Проверьте папку и права доступа.'});}
    return true;
  };
}
