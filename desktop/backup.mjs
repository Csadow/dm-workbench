import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exportCampaign, importBundle } from '../app/backup.js';
import { validateProfile, defaultProfile } from '../app/assistant.js';
import { DesktopStore } from './storage.mjs';
import { atomic, walk, safeRelative } from './files.mjs';
const MAX_BACKUP=500*1024*1024;
export async function snapshot(store) {
  return store.exclusive(async()=>{
    const campaigns=[];
    for(const {id} of store.db.prepare('SELECT id FROM campaigns').all()) {
      const c=await store.reconcile(id),assets=[];
      for(const t of c.soundboard.tracks){const a=await store.asset(t.assetId,id);assets.push({id:a.id,mime:a.mime,base64:Buffer.from(a.data).toString('base64')});}
      campaigns.push(JSON.parse(exportCampaign(c,assets)));
    }
    const profile=validateProfile(JSON.parse(store.db.prepare("SELECT body FROM preferences WHERE id='assistant'").get()?.body||JSON.stringify(defaultProfile())));
    const memory=(await walk(store.root,'memory',12000,100000000)).map(({path,text})=>({path,text}));
    const text=JSON.stringify({application:'dm-workbench-desktop',formatVersion:1,createdAt:new Date().toISOString(),campaigns,profile,memory});
    if(Buffer.byteLength(text)>MAX_BACKUP)throw new Error('Полная копия превышает 500 МБ. Экспортируйте кампании отдельно.');
    return gzipSync(text);
  });
}
export async function writeBackup(store,destination) {
  const data=await snapshot(store);await atomic(dirname(destination),basename(destination),data);return destination;
}
export async function automaticBackup(store) {
  if(!store.db.prepare('SELECT 1 FROM campaigns LIMIT 1').get())return;
  const folder=join(store.root,'backups');await mkdir(folder,{recursive:true,mode:0o700});
  const day=new Date().toISOString().slice(0,10),name=`auto-${day}.dmw-backup.json.gz`;
  if((await readdir(folder)).includes(name))return;
  await writeBackup(store,join(folder,name));
  const names=(await readdir(folder)).filter(n=>/^auto-\d{4}-\d{2}-\d{2}\.dmw-backup\.json\.gz$/.test(n)).sort().reverse();
  for(const old of names.slice(14))await rm(join(folder,old));
}
export function decodeBackup(buffer) {
  if(buffer.length>MAX_BACKUP)throw new Error('Резервная копия больше 500 МБ.');
  let data;try{data=JSON.parse(gunzipSync(buffer,{maxOutputLength:MAX_BACKUP}).toString('utf8'));}catch{throw new Error('Повреждённый файл полной резервной копии.');}
  if(data?.application!=='dm-workbench-desktop'||data.formatVersion!==1||!Array.isArray(data.campaigns)||data.campaigns.length>1000||!Array.isArray(data.memory)||data.memory.length>12000)throw new Error('Неизвестный формат резервной копии.');
  validateProfile(data.profile);
  const ids=new Map(),bundles=[];
  for(const envelope of data.campaigns){const bundle=importBundle(JSON.stringify(envelope));if(ids.has(envelope.campaign.id))throw new Error('В копии повторяется кампания.');ids.set(envelope.campaign.id,bundle.campaign.id);bundle.campaign.name=envelope.campaign.name;bundle.campaign.archived=envelope.campaign.archived;bundles.push(bundle);}
  const paths=new Set();let total=0;
  const memory=data.memory.map(f=>{
    safeRelative(f.path);if(typeof f.text!=='string'||Buffer.byteLength(f.text)>80000||!/^memory\/(shared\/|campaigns\/[a-zA-Z0-9_-]{1,100}\/).+\.md$/.test(f.path)||paths.has(f.path))throw new Error('Неверный файл памяти в копии.');
    paths.add(f.path);total+=Buffer.byteLength(f.text);if(total>100000000)throw new Error('Слишком много памяти в резервной копии.');
    const parts=f.path.split('/');if(parts[1]==='campaigns'&&ids.has(parts[2]))parts[2]=ids.get(parts[2]);return {...f,path:parts.join('/')};
  });
  return {bundles,profile:data.profile,memory};
}
export async function restoreBackup(buffer,parent) {
  // Validate every campaign and memory path before writing a new isolated library.
  const data=decodeBackup(buffer),root=join(parent,'DM Workbench восстановлено '+new Date().toISOString().slice(0,10)+' '+randomUUID().slice(0,8));
  let store;
  try {
    store=await DesktopStore.open(root);
    for(const {campaign,assets} of data.bundles)await store.saveCampaign(campaign,{insert:true,assets:await Promise.all(assets.map(async a=>({id:a.id,campaignId:a.campaignId,mime:a.blob.type,data:new Uint8Array(await a.blob.arrayBuffer())})))});
    await store.saveProfile({...data.profile,revision:0});
    for(const file of data.memory)await atomic(root,file.path,file.text);
    await store.flush();store.close();return root;
  }catch(error){store?.close();await rm(root,{recursive:true,force:true});throw error;}
}
