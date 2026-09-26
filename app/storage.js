import { exportCampaign } from './backup.js';
import { now } from './domain.js';
let connection;
export async function openDatabase() {
  if (connection) return connection;
  connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open('dm-workbench', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('campaigns', { keyPath: 'id' });
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = null; };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Закройте другие вкладки приложения и попробуйте снова.'));
  });
  return connection;
}
export async function listCampaigns() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('campaigns', 'readonly');
    const request = tx.objectStore('campaigns').getAll();
    tx.oncomplete = () => resolve(request.result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    tx.onabort = () => reject(tx.error);
  });
}
// Compare-and-swap inside one read/write transaction also protects concurrent tabs.
export async function saveCampaign(campaign, { insert = false } = {}) {
  const db = await openDatabase();
  const next = structuredClone(campaign);
  next.updatedAt = now(); next.revision += 1;
  exportCampaign(next); // Every committed record must remain exportable and restorable.
  return new Promise((resolve, reject) => {
    const tx = db.transaction('campaigns', 'readwrite');
    const store = tx.objectStore('campaigns');
    let conflict;
    const request = store.get(next.id);
    request.onsuccess = () => {
      const current = request.result;
      if ((insert && current) || (!insert && (!current || current.revision !== campaign.revision))) {
        conflict = new Error('Кампания изменена в другой вкладке. Скопируйте несохранённый текст и обновите страницу.');
        tx.abort(); return;
      }
      store.put(next);
    };
    tx.oncomplete = () => resolve(next);
    tx.onabort = () => reject(conflict || tx.error || new Error('Не удалось сохранить изменения.'));
  });
}
