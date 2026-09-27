import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url),binary=process.env.DMW_TEST_BINARY||require('electron'),root=fileURLToPath(new URL('../',import.meta.url));
const temp=await mkdtemp(join(tmpdir(),'dmw-electron-'));
try {
  for(const phase of ['first','restart']) {
    const report=join(temp,phase+'.json');let output='';
    const args=[...(process.env.DMW_TEST_BINARY?[]:[root]),...(process.env.DMW_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),'--disable-gpu'];
    const child=spawn(binary,args,{env:{...process.env,DMW_DESKTOP_TEST:'1',DMW_TEST_PHASE:phase,DMW_TEST_REPORT:report,DMW_DATA_DIR:join(temp,'library'),DMW_USER_DATA_DIR:join(temp,'profile')},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});
    const timer=setTimeout(()=>child.kill('SIGKILL'),90000);
    const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});clearTimeout(timer);
    let result;try{result=JSON.parse(await readFile(report,'utf8'));}catch{}
    if(code!==0||!result?.ok)throw new Error(JSON.stringify(result||{})+'\n'+output.slice(-10000));
    if(phase==='first'){const {copyFile}=await import('node:fs/promises');await copyFile(report+'.png','/tmp/dmw-desktop.png');}
    console.log(`PASS Electron ${phase}: ${JSON.stringify(result)}`);
  }
}finally{await rm(temp,{recursive:true,force:true});}
