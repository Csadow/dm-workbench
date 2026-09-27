const native = globalThis.dmw?.storage;
import { defaultProfile, validateProfile } from './assistant.js';
import { validateDocument } from './backup.js';
import { migrateCampaign, now } from './domain.js';
let connection;
export async function openDatabase() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('dm-workbench', 3);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('campaigns')) db.createObjectStore('campaigns', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('preferences')) db.createObjectStore('preferences', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); connection = null; };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Для обновления хранилища закройте другие вкладки приложения и повторите.')); };
  }).catch(error => { connection = null; throw error; });
  return connection;
}
export async function listCampaigns() {
  if(native)return native.listCampaigns();
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('campaigns', 'readonly');
    const request = tx.objectStore('campaigns').getAll();
    tx.oncomplete = () => {
      try { resolve(request.result.map(migrateCampaign).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); }
      catch (error) { reject(error); }
    };
    tx.onabort = () => reject(tx.error);
  });
}
// Campaign metadata and new/deleted audio are committed in the same transaction.
export async function saveCampaign(campaign, { insert = false, assets = [], deleteAssets = [] } = {}) {
  if(native)return native.saveCampaign(campaign,{insert,deleteAssets,assets:await Promise.all(assets.map(async a=>({id:a.id,campaignId:a.campaignId,mime:a.blob.type,data:new Uint8Array(await a.blob.arrayBuffer())})))});
  const db = await openDatabase();
  const next = structuredClone(campaign);
  next.updatedAt = now(); next.revision += 1;
  validateDocument(next);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['campaigns', 'media'], 'readwrite');
    const store = tx.objectStore('campaigns'), media = tx.objectStore('media');
    let reason, aborted = false;
    function abort(message) { if (aborted) return; aborted = true; reason = new Error(message); tx.abort(); }
    const request = store.get(next.id);
    request.onsuccess = () => {
      const current = request.result;
      if ((insert && current) || (!insert && (!current || current.revision !== campaign.revision))) {
        abort('Кампания изменена в другой вкладке. Скопируйте несохранённый текст и обновите страницу.'); return;
      }
      const references = new Map(next.soundboard.tracks.map(t => [t.assetId, t]));
      const incoming = new Map(assets.map(a => [a.id, a]));
      if (incoming.size !== assets.length || assets.some(a => !references.has(a.id) || a.campaignId !== next.id) || deleteAssets.some(id => references.has(id))) {
        abort('Аудиофайлы не соответствуют кампании.'); return;
      }
      const previousIds = new Set((current?.soundboard?.tracks || []).map(t => t.assetId));
      if (deleteAssets.some(id => !previousIds.has(id))) { abort('Нельзя удалить аудио другой кампании.'); return; }
      let waiting = references.size;
      function commit() {
        try {
          for (const asset of assets) media.put(asset);
          for (const id of deleteAssets) media.delete(id);
          store.put(next);
        } catch (error) { reason = error; try { tx.abort(); } catch {} }
      }
      if (!waiting) { commit(); return; }
      for (const [id, track] of references) {
        const lookup = media.get(id);
        lookup.onsuccess = () => {
          const existing = lookup.result;
          if (incoming.has(id) && existing) { abort('Этот аудиофайл уже существует.'); return; }
          const asset = incoming.get(id) || existing;
          if (!asset || asset.campaignId !== next.id || !(asset.blob instanceof Blob) || asset.blob.size !== track.bytes || asset.blob.type !== track.mime) {
            abort('Не найден аудиофайл кампании. Восстановите полную резервную копию.'); return;
          }
          waiting -= 1; if (!waiting) commit();
        };
      }
    };
    tx.oncomplete = () => resolve(next);
    tx.onabort = () => reject(reason || tx.error || new Error('Не удалось сохранить изменения.'));
  });
}
export async function getAsset(id, campaignId) {
  if(native){const a=await native.getAsset(id,campaignId);return {...a,blob:new Blob([a.data],{type:a.mime})};}
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('media', 'readonly'), req = tx.objectStore('media').get(id);
    tx.oncomplete = () => req.result?.campaignId === campaignId ? resolve(req.result) : reject(new Error('Аудиофайл не найден в этой кампании.'));
    tx.onabort = () => reject(tx.error);
  });
}
export async function loadCampaignBundle(id) {
  if(native){const b=await native.loadCampaignBundle(id);return {campaign:b.campaign,assets:b.assets.map(a=>({...a,blob:new Blob([a.data],{type:a.mime})}))};}
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['campaigns', 'media'], 'readonly');
    let campaign, error; const assets = [];
    const req = tx.objectStore('campaigns').get(id);
    req.onsuccess = () => {
      try { campaign = migrateCampaign(req.result); validateDocument(campaign); }
      catch (e) { error = e; tx.abort(); return; }
      for (const track of campaign.soundboard.tracks) {
        const media = tx.objectStore('media').get(track.assetId);
        media.onsuccess = () => {
          if (!media.result || media.result.campaignId !== id) { error = new Error('В копии отсутствует аудиофайл.'); tx.abort(); return; }
          assets.push(media.result);
        };
      }
    };
    tx.oncomplete = () => resolve({ campaign, assets });
    tx.onabort = () => reject(error || tx.error);
  });
}

export async function loadProfile() {
  if(native)return native.loadProfile();
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{const tx=db.transaction('preferences','readonly'),req=tx.objectStore('preferences').get('assistant');tx.oncomplete=()=>{try{resolve(validateProfile(req.result||defaultProfile()));}catch(e){reject(e);}};tx.onabort=()=>reject(tx.error);});
}
export async function saveProfile(profile) {
  if(native)return native.saveProfile(profile);
  validateProfile(profile); const db=await openDatabase(),next=structuredClone(profile); next.revision++;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('preferences','readwrite'),store=tx.objectStore('preferences'),req=store.get('assistant'); let reason;
    req.onsuccess=()=>{if((req.result?.revision||0)!==profile.revision){reason=new Error('Память изменена в другой вкладке. Обновите страницу.');tx.abort();return;}store.put(next);};
    tx.oncomplete=()=>resolve(next);tx.onabort=()=>reject(reason||tx.error);
  });
}
