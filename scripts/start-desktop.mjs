import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../',import.meta.url));
let executable;
try{executable=require('electron');}catch{console.error('Установите зависимости: pnpm install; затем node node_modules/electron/install.js');process.exit(1);}
const child=spawn(executable,[root,...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,DMW_AI_DIR:process.env.DMW_AI_DIR||join(root,'.local-ai')}});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
