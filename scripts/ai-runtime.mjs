import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export const localDir=join(projectRoot,'.local-ai');
export const MODEL='qwen3.5:4b';
export async function executable() {
  const path=join(localDir,'runtime','bin','ollama');
  try{await access(path);return path;}catch{return 'ollama';}
}
export async function ollamaReady() {
  try{return (await fetch('http://127.0.0.1:11434/api/version',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}
}
export async function ensureOllama() {
  if(await ollamaReady())return null;
  await mkdir(localDir,{recursive:true});
  const log=createWriteStream(join(localDir,'ollama.log'),{flags:'a'});
  const child=spawn(await executable(),['serve'],{cwd:projectRoot,env:{...process.env,OLLAMA_HOST:'127.0.0.1:11434',OLLAMA_NO_CLOUD:'1',OLLAMA_MODELS:join(localDir,'models'),OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_CONTEXT_LENGTH:'16384'},stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  let failure;child.on('error',e=>{failure=e;});child.on('exit',()=>log.end());
  for(let i=0;i<100;i++) {
    if(failure||child.exitCode!==null){child.kill();throw new Error('Ollama не установлен или не запустился. Выполните node scripts/setup-local-ai.mjs.');}
    if(await ollamaReady())return child;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  child.kill();throw new Error('Ollama не ответил. Подробности в .local-ai/ollama.log.');
}
