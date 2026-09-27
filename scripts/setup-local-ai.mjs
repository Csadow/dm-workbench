// One-time download. Chat and generation never call remote services.
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { localDir, ensureOllama, MODEL } from './ai-runtime.mjs';
const VERSION='v0.34.4';
const SHA256='c238986e61d40c0cc5f4a9b9e40b9eea104350b77efa34741fc134e105cb9533';
async function run(command,args) {await new Promise((resolve,reject)=>{const p=spawn(command,args,{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(`${command}: код ${code}`)));});}
async function exists(path){try{await access(path);return true;}catch{return false;}}
let child;
try {
  await mkdir(localDir,{recursive:true});
  const binary=join(localDir,'runtime','bin','ollama');
  if(!await exists(binary)) {
    if(process.platform!=='linux'||process.arch!=='x64')throw new Error('Для этой ОС сначала установите Ollama с https://ollama.com/download, запустите его и выполните ollama pull qwen3.5:4b.');
    const archive=join(localDir,'ollama-linux-amd64.tar.zst');
    console.log(`Ollama ${VERSION}: первоначальная загрузка около 1,4 ГБ.`);
    if(!await exists(archive))await run('curl',['-fL','--retry','3','--retry-all-errors',`https://github.com/ollama/ollama/releases/download/${VERSION}/ollama-linux-amd64.tar.zst`,'-o',archive]);
    const hash=createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk);
    if(hash.digest('hex')!==SHA256)throw new Error('Контрольная сумма архива не совпала. Удалите .local-ai/ollama-linux-amd64.tar.zst и повторите загрузку.');
    await mkdir(join(localDir,'runtime'),{recursive:true});await run('tar',['-xf',archive,'-C',join(localDir,'runtime')]);
    await rm(archive);
  }
  child=await ensureOllama();
  console.log(`Модель ${MODEL}: первоначальная загрузка около 3,4 ГБ. Последующая работа — без интернета.`);
  const response=await fetch('http://127.0.0.1:11434/api/pull',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,stream:true})});
  if(!response.ok)throw new Error('Не удалось начать загрузку модели.');
  const decoder=new TextDecoder();let buffer='',last='',success=false;
  for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;const data=JSON.parse(line);if(data.error)throw new Error(data.error);const status=data.total?`${data.status}: ${Math.floor((data.completed||0)/data.total*10)*10}%`:data.status;if(status!==last){console.log(status);last=status;}if(data.status==='success')success=true;}}
  if(!success)throw new Error('Загрузка модели прервана. Повторите команду — Ollama продолжит загрузку.');
  console.log('Готово. Запуск: node scripts/start-local.mjs');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{child?.kill('SIGTERM');}
