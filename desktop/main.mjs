import { app, BrowserWindow, protocol, ipcMain, dialog, shell, Menu } from 'electron';
import { readFile, mkdir, access, readdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopStore } from './storage.mjs';
import { writeBackup, restoreBackup, automaticBackup } from './backup.mjs';
import { atomic, walk } from './files.mjs';
import { createAppServer } from '../scripts/serve.mjs';
import { ensureOllama, stopOllama } from '../scripts/ai-runtime.mjs';
import { setupLocalAI } from '../scripts/setup-local-ai.mjs';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
protocol.registerSchemesAsPrivileged([{scheme:'dmw',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
if(process.env.DMW_USER_DATA_DIR)app.setPath('userData',resolve(process.env.DMW_USER_DATA_DIR));
app.setName('DM Workbench');
if(!app.requestSingleInstanceLock()){app.quit();} else {
let win,store,server,origin,ownedAI,settings={},aiProgress='',aiBusy=false,closing=false;
const lifetime=new AbortController();
const configDir=app.getPath('userData');
const configFile=join(configDir,'desktop.json');
const fakeAI=process.env.DMW_DESKTOP_TEST==='1'?async(url,options={})=>{
  if(url.endsWith('/api/tags'))return Response.json({models:[{name:'qwen3.5:4b',size:3400000000,details:{format:'gguf'}}]});
  if(url.endsWith('/api/show'))return Response.json({details:{format:'gguf'},capabilities:['completion']});
  return Response.json({message:{content:'Мира Вейл ищет брата. Предложение: встретиться у маяка. [К1]'}});
}:undefined;
async function persistSettings() {await atomic(configDir,'desktop.json',JSON.stringify(settings,null,2));}
async function startServer() {
  server=createAppServer({vaultRoot:join(store.root,'memory'),...(fakeAI?{fetchImpl:fakeAI}:{})});
  await new Promise((res,rej)=>{server.once('error',rej);server.listen(0,'127.0.0.1',res);});
  origin=`http://127.0.0.1:${server.address().port}`;
}
async function startAI() {
  if(fakeAI)return;
  if(aiBusy)return;aiBusy=true;aiProgress='Запускаем локальный ИИ…';
  try{const child=await ensureOllama({directory:settings.aiDir,signal:lifetime.signal});if(closing){await stopOllama(child);return;}if(child)ownedAI=child;aiProgress='Локальный ИИ запущен';}
  catch(error){aiProgress=error.message;}
  finally{aiBusy=false;}
}
async function openLibrary(root) {
  const next=await DesktopStore.open(root);
  const old=store;store=next;
  if(server)await new Promise(res=>server.close(res));
  await startServer();old?.close();settings.library=root;await persistSettings();
  try{await automaticBackup(store);}catch(error){store.warning='Автоматическая копия не создана: '+error.message;}
}
async function chooseLibrary() {
  const result=await dialog.showOpenDialog(win,{title:'Открыть папку хранилища',properties:['openDirectory','createDirectory']});
  if(result.canceled)return false;
  const root=result.filePaths[0],files=await readdir(root);
  if(resolve(root)===store.root)return false;
  if(files.length&&!files.includes('workbench.sqlite'))throw new Error('Выберите пустую папку или существующее хранилище DM Workbench.');
  await openLibrary(root);return true;
}
const handlers={
  listCampaigns:()=>store.listCampaigns(),saveCampaign:(...args)=>store.saveCampaign(...args),getAsset:(...args)=>store.getAsset(...args),
  loadCampaignBundle:id=>store.loadCampaignBundle(id),loadProfile:()=>store.loadProfile(),saveProfile:p=>store.saveProfile(p),
  linkImport:(source,target)=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(source)||!store.current(target))throw new Error('Неверный импорт.');store.db.prepare('INSERT OR REPLACE INTO imports(source,target) VALUES(?,?)').run(source,target);},
  info:()=>({root:store.root,warning:store.warning,aiProgress,aiBusy,aiDir:settings.aiDir,version:app.getVersion()}),
  openFolder:()=>shell.openPath(store.root),chooseLibrary,
  backup:async()=>{
    const result=await dialog.showSaveDialog(win,{title:'Полная резервная копия',defaultPath:`DM Workbench ${new Date().toISOString().slice(0,10)}.dmw-backup.json.gz`,filters:[{name:'Полная копия DM Workbench',extensions:['gz']}]});
    if(result.canceled)return null;return writeBackup(store,result.filePath);
  },
  restore:async()=>{
    const file=await dialog.showOpenDialog(win,{title:'Восстановить полную копию в новое хранилище',properties:['openFile'],filters:[{name:'Полная копия DM Workbench',extensions:['gz']}]});if(file.canceled)return false;
    const parent=await dialog.showOpenDialog(win,{title:'Где создать восстановленное хранилище',properties:['openDirectory','createDirectory']});if(parent.canceled)return false;
    const root=await restoreBackup(await readFile(file.filePaths[0]),parent.filePaths[0]);await openLibrary(root);return true;
  },
  importLegacyMemory:async()=>{
    const chosen=await dialog.showOpenDialog(win,{title:'Выберите папку vault/memory из веб-версии',properties:['openDirectory']});if(chosen.canceled)return {copied:0,skipped:0};
    const source=chosen.filePaths[0];let count=0,skipped=0;
    // Copy only missing files; original campaign IDs stay available for matching JSON imports.
    for(const scope of ['shared','campaigns'])for(const f of await walk(source,scope,12000,100000000)) {
      const parts=f.path.split('/');
      if(parts[0]==='campaigns'){const match=store.db.prepare('SELECT target FROM imports WHERE source=?').get(parts[1]);if(match)parts[1]=match.target;else if(!store.current(parts[1])){skipped++;continue;}}
      const path='memory/'+parts.join('/');
      try{await access(join(store.root,path));skipped++;continue;}catch{}
      await atomic(store.root,path,f.text);count++;
    }
    return {copied:count,skipped};
  },
  startAI:async()=>{await startAI();return handlers.info();},
  chooseAI:async()=>{
    if(aiBusy)throw new Error('Дождитесь завершения текущего запуска или загрузки ИИ.');
    const result=await dialog.showOpenDialog(win,{title:'Папка установленного ИИ (.local-ai)',properties:['openDirectory']});if(result.canceled)return false;
    settings.aiDir=result.filePaths[0];await persistSettings();await stopOllama(ownedAI);ownedAI=null;await startAI();return true;
  },
  setupAI:async()=>{
    if(aiBusy)return false;
    aiBusy=true;aiProgress='Начинаем загрузку Ollama и модели…';
    setupLocalAI({directory:settings.aiDir,signal:lifetime.signal,progress:text=>{aiProgress=text;}}).then(async()=>{aiBusy=false;if(!closing)await startAI();}).catch(error=>{aiProgress=error.message;aiBusy=false;});return true;
  }
};
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.on('before-quit',event=>{
  if(closing)return;
  // The renderer's beforeunload runs before shutdown, so cancelling close keeps services alive.
  if(win&&!win.isDestroyed()){event.preventDefault();win.close();return;}
  closing=true;lifetime.abort();ownedAI?.kill('SIGTERM');server?.close();store?.close();
});
app.on('window-all-closed',()=>app.quit());
// Electron emits ready after the entry module finishes evaluating.
app.whenReady().then(async()=>{
try {
  await mkdir(configDir,{recursive:true,mode:0o700});
  try{settings=JSON.parse(await readFile(configFile,'utf8'));}catch{}
  settings.aiDir=process.env.DMW_AI_DIR||settings.aiDir||join(configDir,'local-ai');
  await openLibrary(resolve(process.env.DMW_DATA_DIR||settings.library||join(app.getPath('documents'),'DM Workbench')));
  protocol.handle('dmw',async request=>{
    const url=new URL(request.url);if(url.host!=='app')return new Response('Not found',{status:404});
    try {
      if(/^\/api\/(ai\/(status|chat)|memory(?:\/file)?)$/.test(url.pathname)) {
        const headers={'Origin':origin,'Content-Type':'application/json'};
        const body=['GET','HEAD'].includes(request.method)?undefined:await request.text();
        if(body&&body.length>150000)return new Response('Too large',{status:413});
        return await fetch(origin+url.pathname+url.search,{method:request.method,headers,body,signal:request.signal});
      }
      const path=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
      if(request.method!=='GET'||!/^(index\.html|manifest.webmanifest|app\/[a-z-]+\.(js|css)|assets\/[a-z0-9-]+\.(svg|png|json))$/.test(path))return new Response('Not found',{status:404});
      return new Response(await readFile(join(sourceRoot,path)),{headers:{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'}[extname(path)]+'; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'"}});
    }catch(error){return new Response('Unavailable',{status:503});}
  });
  ipcMain.handle('dmw:invoke',async(event,name,args)=>{
    if(!win||event.sender!==win.webContents||event.senderFrame!==event.sender.mainFrame||!event.senderFrame.url.startsWith('dmw://app/')||!Object.hasOwn(handlers,name)||!Array.isArray(args)||args.length>3)throw new Error('Недопустимый запрос приложения.');
    return handlers[name](...args);
  });
  win=new BrowserWindow({title:'DM Workbench',width:1440,height:940,minWidth:960,minHeight:650,show:false,backgroundColor:'#f6f4ef',webPreferences:{preload:join(sourceRoot,'desktop/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win.webContents.session.setPermissionCheckHandler(()=>false);
  win.webContents.setWindowOpenHandler(({url})=>{try{const u=new URL(url);if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password)shell.openExternal(u.href);}catch{}return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('dmw://app/'))event.preventDefault();});
  win.webContents.on('will-prevent-unload',event=>{
    const answer=dialog.showMessageBoxSync(win,{type:'question',buttons:['Остаться','Закрыть'],defaultId:0,cancelId:0,message:'Есть несохранённые изменения или выполняется запрос ИИ.',detail:'Закрыть приложение? Скопируйте или сохраните нужный текст перед выходом.'});
    if(answer===1)event.preventDefault();
  });
  win.on('closed',()=>{win=null;});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Мастерская',submenu:[{label:'Открыть папку данных',click:handlers.openFolder},{type:'separator'},{role:'quit',label:'Выйти'}]},{label:'Правка',submenu:[{role:'undo',label:'Отменить'},{role:'redo',label:'Повторить'},{type:'separator'},{role:'cut',label:'Вырезать'},{role:'copy',label:'Копировать'},{role:'paste',label:'Вставить'},{role:'selectAll',label:'Выбрать всё'}]},{label:'Вид',submenu:[{role:'reload',label:'Обновить записи'},{role:'resetZoom',label:'Обычный масштаб'},{role:'zoomIn',label:'Увеличить'},{role:'zoomOut',label:'Уменьшить'},{role:'togglefullscreen',label:'Полный экран'}]}]));
  await win.loadURL('dmw://app/');win.show();
  startAI();
  if(process.env.DMW_DESKTOP_TEST==='1'&&process.env.DMW_TEST_REPORT) {
    const {runDesktopChecks}=await import('../scripts/desktop-checks.mjs');
    await runDesktopChecks({win,store,handlers,report:process.env.DMW_TEST_REPORT});
    win.destroy();app.quit();
  }
}catch(error){console.error(error);if(process.env.DMW_DESKTOP_TEST!=='1')dialog.showErrorBox('DM Workbench: ошибка запуска',error.message);app.exit(1);}
});
}
