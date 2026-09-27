import { getAsset } from './storage.js';
import { MAX_AUDIO_BYTES, AUDIO_TYPES } from './backup.js';

const mimeByExtension = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'audio/mp4', flac: 'audio/flac', webm: 'audio/webm', aac: 'audio/aac' };
export async function prepareAudio(file) {
  if (!file || !file.size || file.size > MAX_AUDIO_BYTES) throw new Error('Выберите аудиофайл размером до 20 МБ.');
  const mime = AUDIO_TYPES.includes(file.type) ? file.type : mimeByExtension[file.name.split('.').at(-1).toLowerCase()];
  if (!mime) throw new Error('Поддерживаются MP3, WAV, OGG, M4A, FLAC, AAC и WebM.');
  const blob = file.slice(0, file.size, mime), url = URL.createObjectURL(blob), audio = new Audio();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Не удалось проверить аудиофайл за 10 секунд.')), 10000);
      audio.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      audio.onerror = () => { clearTimeout(timer); reject(new Error('Браузер не может прочитать этот аудиофайл. Попробуйте MP3 или WAV.')); };
      audio.preload = 'metadata'; audio.src = url;
    });
    return blob;
  } finally { audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); }
}

// Audio objects live outside UI rendering. Navigation never restarts a track.
export class SoundMixer {
  constructor(onChange = () => {}, onError = () => {}) {
    this.players = new Map(); this.pending = new Set(); this.versions = new Map();
    this.masterVolume = 0.7; this.campaignId = null; this.generation = 0;
    this.onChange = onChange; this.onError = onError;
  }
  setCampaign(campaign) {
    if (this.campaignId !== (campaign?.id || null)) { this.stopAll(); this.campaignId = campaign?.id || null; }
    this.setMaster(campaign?.soundboard.masterVolume ?? 0.7);
  }
  setMaster(value) { this.masterVolume = value; for (const p of this.players.values()) p.audio.volume = p.volume * value; }
  setVolume(id, value) { const p = this.players.get(id); if (p) { p.volume = value; p.audio.volume = value * this.masterVolume; } }
  level(id, fallback) { return this.players.get(id)?.volume ?? fallback; }
  playing(id) { const p = this.players.get(id); return Boolean(p && !p.audio.paused && !p.audio.ended); }
  activeLayers() { return [...this.players].filter(([id]) => this.playing(id)).map(([trackId, p]) => ({ trackId, volume: p.volume })); }
  stop(id, notify = true) {
    this.versions.set(id, (this.versions.get(id) || 0) + 1); this.pending.delete(id);
    const p = this.players.get(id);
    if (p) { p.audio.pause(); p.audio.onended = null; p.audio.onerror = null; p.audio.removeAttribute('src'); p.audio.load(); p.audio.remove(); URL.revokeObjectURL(p.url); this.players.delete(id); }
    if (notify) this.onChange();
  }
  stopAll() { this.generation++; for (const id of [...this.players.keys(), ...this.pending]) this.stop(id, false); this.onChange(); }
  async toggle(track, campaignId) {
    const p = this.players.get(track.id);
    if (p && track.kind !== 'effect') {
      if (!p.audio.paused) p.audio.pause();
      else { try { await p.audio.play(); } catch { this.stop(track.id); throw new Error('Воспроизведение недоступно. Нажмите запуск ещё раз.'); } }
      this.onChange(); return;
    }
    return this.play(track, campaignId);
  }
  async play(track, campaignId, level = track.volume) {
    if (campaignId !== this.campaignId) return;
    if (this.players.size + this.pending.size >= 16 && !this.players.has(track.id)) throw new Error('Можно включить до 16 звуков одновременно.');
    this.stop(track.id, false);
    const generation = this.generation, version = this.versions.get(track.id);
    this.pending.add(track.id);
    try {
      const asset = await getAsset(track.assetId, campaignId);
      if (generation !== this.generation || version !== this.versions.get(track.id) || campaignId !== this.campaignId) return;
      const url = URL.createObjectURL(asset.blob), audio = new Audio(url);
      // Keep media attached outside #app so page rendering cannot detach it.
      audio.hidden = true; document.body.append(audio);
      audio.loop = track.loop; audio.volume = level * this.masterVolume;
      this.players.set(track.id, { audio, url, volume: level, name: track.name });
      audio.onended = () => this.stop(track.id);
      audio.onerror = () => { this.stop(track.id); this.onError(new Error(`Не удалось воспроизвести «${track.name}». Проверьте формат аудио.`)); };
      try { await audio.play(); }
      catch {
        if (generation !== this.generation || version !== this.versions.get(track.id)) return;
        this.stop(track.id); throw new Error('Браузер не запустил звук. Нажмите воспроизведение ещё раз или выберите другой формат.');
      }
    } finally {
      if (version === this.versions.get(track.id)) this.pending.delete(track.id);
      this.onChange();
    }
  }
  async playMood(mood, campaign) {
    this.stopAll();
    const results = await Promise.allSettled(mood.layers.map(layer => this.play(campaign.soundboard.tracks.find(t => t.id === layer.trackId), campaign.id, layer.volume)));
    const failed = results.find(r => r.status === 'rejected');
    if (failed) { this.stopAll(); throw failed.reason; }
  }
}
