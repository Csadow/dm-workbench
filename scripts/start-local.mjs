import { createAppServer } from './serve.mjs';
import { ensureOllama } from './ai-runtime.mjs';
let child;
try{child=await ensureOllama();console.log('Локальный ИИ: Ollama на 127.0.0.1:11434');}
catch(error){console.log(error.message);console.log('Приложение запустится; ИИ можно подключить позже.');}
const port=Number(process.env.PORT||4173),server=createAppServer();
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Порт ${port} уже занят. Закройте прежний сервер приложения и повторите запуск.`:error.message);child?.kill('SIGTERM');process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`DM Workbench: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child?.kill('SIGTERM');server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();});
