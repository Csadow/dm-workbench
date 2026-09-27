import { DatabaseSync } from 'node:sqlite';
import { mkdir, rename } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { validateDocument, MAX_AUDIO_BYTES } from '../app/backup.js';
import { defaultProfile, validateProfile } from '../app/assistant.js';
import { migrateCampaign, now, createEntry, removeEntry } from '../app/domain.js';
import { noteFolder, validFolder, renameWikiLinks } from '../app/markdown.js';
import { atomic, bytes, digest, inside, walk, slug, noteFile, parseNote } from './files.mjs';

const validId=id=>{if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new Error('Неверный ID.');return id;};
export class DesktopStore {
  static async open(root) {
    root=resolve(root);await mkdir(root,{recursive:true,mode:0o700});
    const dbFile=await inside(root,'workbench.sqlite');
    const db=new DatabaseSync(dbFile);
    try{const store=new DesktopStore(root,db);await store.flush();return store;}
    catch(error){db.close();throw error;}
  }
  constructor(root,db) {
    this.root=root;this.db=db;this.warning='';this.queue=Promise.resolve();
    const version=db.prepare('PRAGMA user_version').get().user_version;
    const identity=db.prepare('PRAGMA application_id').get().application_id;
    if(version>1)throw new Error('Хранилище создано более новой версией DM Workbench. Обновите приложение.');
    if(identity!==0x444d5701&&(identity!==0||db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").get()))throw new Error('Этот файл SQLite не является хранилищем DM Workbench.');
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, campaign TEXT NOT NULL, path TEXT UNIQUE NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY, campaign TEXT NOT NULL, path TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS preferences(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending(id INTEGER PRIMARY KEY, path TEXT NOT NULL, before_hash TEXT, data BLOB);
      CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY, campaign TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS imports(source TEXT PRIMARY KEY, target TEXT NOT NULL);
      PRAGMA application_id=1145919233; PRAGMA user_version=1;`);
  }
  exclusive(fn) { const task=this.queue.catch(()=>{}).then(fn);this.queue=task;return task; }
  close() {this.db.close();}
  current(id) {const row=this.db.prepare('SELECT body FROM campaigns WHERE id=?').get(validId(id));return row?migrateCampaign(JSON.parse(row.body)):null;}
  snapshot(c) {
    if(!c)return;
    this.db.prepare('INSERT INTO history(campaign,body,created) VALUES(?,?,?)').run(c.id,JSON.stringify(c),now());
    this.db.prepare('DELETE FROM history WHERE campaign=? AND id NOT IN (SELECT id FROM history WHERE campaign=? ORDER BY id DESC LIMIT 20)').run(c.id,c.id);
  }
  async flush() {
    for(const op of this.db.prepare('SELECT * FROM pending ORDER BY id').all()) {
      const current=await bytes(this.root,op.path),hash=current?digest(current):null,newHash=op.data?digest(op.data):null;
      if(hash!==newHash) {
        if(hash!==op.before_hash)throw new Error(`Файл изменился во время сохранения: ${op.path}. Сохраните его копию и восстановите исходную версию для завершения операции.`);
        if(op.data!==null)await atomic(this.root,op.path,op.data);
        else if(current) {
          const from=await inside(this.root,op.path),to=await inside(this.root,`.trash/${Date.now()}-${op.id}-${basename(op.path)}`,{parents:true});
          await rename(from,to);
        }
      }
      this.db.prepare('DELETE FROM pending WHERE id=?').run(op.id);
    }
    this.warning='';
  }
  async commit(c,old,observed,incoming=[],removed=[]) {
    validateDocument(c);
    const existing=this.db.prepare('SELECT * FROM notes WHERE campaign=?').all(c.id),oldById=new Map(existing.map(n=>[n.id,n]));
    const noteRows=[],ops=incoming.map(asset=>({path:asset.path,before:null,data:asset.data})),used=new Set();
    for(const id of removed){const asset=this.db.prepare('SELECT * FROM media WHERE id=? AND campaign=?').get(id,c.id);if(asset){const data=await bytes(this.root,asset.path);if(data)ops.push({path:asset.path,before:digest(data),data:null});}}
    for(const e of c.entries) {
      let folder=noteFolder(e).split('/').filter(Boolean).map(slug).join('/');
      let path=`campaigns/${c.id}/notes/${folder?folder+'/':''}${slug(e.name)}.md`;
      if(used.has(path.toLocaleLowerCase()))path=path.slice(0,-3)+'-'+e.id+'.md';
      used.add(path.toLocaleLowerCase());
      const data=Buffer.from(noteFile(e)),oldNote=oldById.get(e.id);
      const physical=observed.get(path);
      // Never overwrite an unrelated external note that happens to use the target filename.
      if(physical && parseNote(physical.text).id!==e.id && oldNote?.path!==path)throw new Error(`Имя файла уже занято: ${path}`);
      if(physical?.hash!==digest(data))ops.push({path,before:physical?.hash??null,data});
      noteRows.push({id:e.id,path,hash:digest(data)});
    }
    for(const [path,file] of observed)if(!noteRows.some(n=>n.path===path))ops.push({path,before:file.hash,data:null});
    // Recheck every source immediately before committing the write journal.
    for(const [path,file] of observed)if(digest(await bytes(this.root,path)||Buffer.alloc(0))!==file.hash)throw new Error(`Заметка изменилась в другом редакторе: ${path}. Обновите записи.`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const latest=this.current(c.id);
      if((old&&latest?.revision!==old.revision)||(!old&&latest))throw new Error('Кампания изменена другим окном. Обновите записи.');
      this.snapshot(old);
      this.db.prepare('INSERT OR REPLACE INTO campaigns(id,body) VALUES(?,?)').run(c.id,JSON.stringify(c));
      this.db.prepare('DELETE FROM notes WHERE campaign=?').run(c.id);
      for(const n of noteRows)this.db.prepare('INSERT INTO notes(id,campaign,path,hash) VALUES(?,?,?,?)').run(n.id,c.id,n.path,n.hash);
      for(const asset of incoming)this.db.prepare('INSERT INTO media(id,campaign,path,mime,bytes) VALUES(?,?,?,?,?)').run(asset.id,c.id,asset.path,asset.mime,asset.data.length);
      for(const id of removed)this.db.prepare('DELETE FROM media WHERE id=? AND campaign=?').run(id,c.id);
      for(const op of ops)this.db.prepare('INSERT INTO pending(path,before_hash,data) VALUES(?,?,?)').run(op.path,op.before,op.data);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    try{await this.flush();}catch(error){this.warning='Состояние сохранено в SQLite; запись файлов ещё не завершена. '+error.message;}
    return c;
  }
  async reconcile(id) {
    await this.flush();const c=this.current(id);if(!c)return null;
    const old=structuredClone(c),found=await walk(this.root,`campaigns/${id}/notes`),observed=new Map(found.map(f=>[f.path,f]));
    const indexed=this.db.prepare('SELECT * FROM notes WHERE campaign=?').all(id),byPath=new Map(indexed.map(n=>[n.path,n])),seen=new Set();let changed=false;
    for(const file of found) {
      const parsed=parseNote(file.text),noteId=parsed.id||byPath.get(file.path)?.id;
      if(noteId&&seen.has(noteId))throw new Error(`Повторяется dmw-id в Markdown: ${file.path}`);
      const e=c.entries.find(e=>e.id===noteId),previous=indexed.find(n=>n.id===noteId);
      const relative=file.path.slice(`campaigns/${id}/notes/`.length),folder=dirname(relative)==='.'?'':dirname(relative),name=basename(relative,'.md');
      if(!validFolder(folder))throw new Error(`Недопустимая папка заметки: ${folder}`);
      if(e) {
        seen.add(e.id);
        if(previous?.hash!==file.hash||previous?.path!==file.path) {
          const updated={...e,text:parsed.text,updatedAt:now()};
          if(previous?.path!==file.path){updated.name=name;updated.folder=folder;renameWikiLinks(c,e,updated);}
          Object.assign(e,updated);changed=true;
        }
      } else {
        const entry=createEntry('note',name,parsed.text);entry.folder=folder;
        c.entries.push(entry);seen.add(entry.id);changed=true;
        // Adopt a new external file without deleting its contents on a filename collision.
        file.text=noteFile(entry); // Keep the actual disk hash for the optimistic check.
      }
    }
    for(const e of [...c.entries])if(!seen.has(e.id)){removeEntry(c,e.id);changed=true;}
    if(changed){c.revision++;c.updatedAt=now();await this.commit(c,old,observed);}
    return c;
  }
  listCampaigns() {return this.exclusive(async()=>{
    const result=[];for(const {id} of this.db.prepare('SELECT id FROM campaigns').all())result.push(await this.reconcile(id));
    return result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  });}
  saveCampaign(campaign,{insert=false,assets=[],deleteAssets=[]}={}) {return this.exclusive(async()=>{
    await this.flush();const current=await this.reconcile(validId(campaign.id));
    if((insert&&current)||(!insert&&(!current||current.revision!==campaign.revision)))throw new Error('Кампания изменена в Obsidian или другом окне. Скопируйте черновик и обновите записи.');
    const next=structuredClone(campaign);next.updatedAt=now();next.revision++;validateDocument(next);
    if(!Array.isArray(assets)||!Array.isArray(deleteAssets))throw new Error('Неверные аудиоданные.');
    const references=new Map(next.soundboard.tracks.map(t=>[t.assetId,t])),incoming=new Map(assets.map(a=>[a.id,a]));
    const previous=new Set(current?.soundboard.tracks.map(t=>t.assetId)||[]);
    if(incoming.size!==assets.length||assets.some(a=>!references.has(a.id)||a.campaignId!==next.id)||deleteAssets.some(id=>references.has(id)||!previous.has(id)))throw new Error('Аудиофайлы не соответствуют кампании.');
    const media=[];
    for(const [id,track] of references) {
      const old=this.db.prepare('SELECT * FROM media WHERE id=?').get(validId(id)),added=incoming.get(id);
      if(added) {
        if(old||added.mime!==track.mime||!(added.data instanceof Uint8Array)||added.data.length!==track.bytes||added.data.length>MAX_AUDIO_BYTES)throw new Error('Неверный или уже существующий аудиофайл.');
        const asset={...added,path:`campaigns/${next.id}/audio/${id}.${({ 'audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/ogg':'ogg','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/flac':'flac','audio/webm':'webm','audio/aac':'aac'})[track.mime]}`};
        if(await bytes(this.root,asset.path))throw new Error('Файл аудио уже существует.');
        media.push(asset);
      } else if(!old||old.campaign!==next.id||old.mime!==track.mime||old.bytes!==track.bytes||!(await bytes(this.root,old.path,MAX_AUDIO_BYTES)))throw new Error('Аудиофайл отсутствует. Восстановите резервную копию.');
    }
    const observed=new Map((await walk(this.root,`campaigns/${next.id}/notes`)).map(f=>[f.path,f]));
    return this.commit(next,current,observed,media,deleteAssets);
  });}
  async asset(id,campaignId) {
    const row=this.db.prepare('SELECT * FROM media WHERE id=? AND campaign=?').get(validId(id),validId(campaignId));
    if(!row)throw new Error('Аудиофайл не найден в кампании.');const data=await bytes(this.root,row.path,MAX_AUDIO_BYTES);
    if(!data||data.length!==row.bytes)throw new Error('Аудиофайл повреждён или удалён.');
    return {id,campaignId,mime:row.mime,data:new Uint8Array(data)};
  }
  getAsset(id,campaignId) {return this.exclusive(()=>this.asset(id,campaignId));}
  loadCampaignBundle(id) {return this.exclusive(async()=>{
    const campaign=await this.reconcile(id);if(!campaign)throw new Error('Кампания не найдена.');
    const assets=[];for(const t of campaign.soundboard.tracks)assets.push(await this.asset(t.assetId,id));return {campaign,assets};
  });}
  loadProfile() {return this.exclusive(async()=>validateProfile(JSON.parse(this.db.prepare("SELECT body FROM preferences WHERE id='assistant'").get()?.body||JSON.stringify(defaultProfile()))));}
  saveProfile(profile) {return this.exclusive(async()=>{
    validateProfile(profile);const old=JSON.parse(this.db.prepare("SELECT body FROM preferences WHERE id='assistant'").get()?.body||'{"revision":0}');
    if(old.revision!==profile.revision)throw new Error('Профиль изменился в другом окне.');
    const next={...profile,revision:profile.revision+1};this.db.prepare("INSERT OR REPLACE INTO preferences(id,body) VALUES('assistant',?)").run(JSON.stringify(next));return next;
  });}
}
