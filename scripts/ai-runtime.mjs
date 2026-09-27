import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export const localDir=join(projectRoot,'.local-ai');
export const MODEL='qwen3.5:4b';
export async function executable(directory=localDir) {
  const path=join(directory,'runtime','bin',process.platform==='win32'?'ollama.exe':'ollama');
  try{await access(path);return path;}catch{return 'ollama';}
}
export async function ollamaReady() {
  try{return (await fetch('http://127.0.0.1:11434/api/version',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}
}
export async function stopOllama(child) {
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
}
export async function ensureOllama({directory=localDir,signal}={}) {
  signal?.throwIfAborted();
  if(await ollamaReady())return null;
  await mkdir(directory,{recursive:true});
  let failure;
  const log=createWriteStream(join(directory,'ollama.log'),{flags:'a'});
  log.on('error',error=>{failure=error;});
  const child=spawn(await executable(directory),['serve'],{cwd:directory,env:{...process.env,OLLAMA_HOST:'127.0.0.1:11434',OLLAMA_NO_CLOUD:'1',OLLAMA_MODELS:join(directory,'models'),OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_CONTEXT_LENGTH:'16384'},stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  child.on('error',e=>{failure=e;});child.on('exit',()=>log.end());
  try{for(let i=0;i<100;i++) {
    signal?.throwIfAborted();
    if(failure||child.exitCode!==null){child.kill();throw new Error('Ollama не установлен или не запустился. Выберите папку ИИ или установите его через настройки приложения.');}
    if(await ollamaReady())return child;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error('Ollama не ответил. Подробности в ollama.log в папке ИИ.');
  }catch(error){child.kill();log.end();throw error;}
}
