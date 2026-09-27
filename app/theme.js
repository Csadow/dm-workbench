// Blocking head script: apply the saved appearance before the first paint.
// No inline script or filesystem access is needed in the renderer.
(() => {
  const choices = ['dark', 'light', 'system'];
  const key = 'dmw-theme';
  const system = matchMedia('(prefers-color-scheme: dark)');
  let preference = globalThis.dmw?.initialTheme || 'dark';
  try { const saved = localStorage.getItem(key); if (choices.includes(saved)) preference = saved; } catch {}
  function apply() {
    const effective = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = effective;
    document.documentElement.dataset.themePreference = preference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', effective === 'dark' ? '#151519' : '#f6f4ef');
    document.querySelectorAll('[data-theme-choice]').forEach(select => { select.value = preference; });
  }
  system.addEventListener('change', () => { if (preference === 'system') apply(); });
  addEventListener('storage', event => {
    if (event.key === key && choices.includes(event.newValue) && !globalThis.dmw) { preference = event.newValue; apply(); }
  });
  globalThis.workbenchTheme = Object.freeze({
    get preference() { return preference; },
    async set(value) {
      if (!choices.includes(value)) throw new Error('Неизвестная тема.');
      if (globalThis.dmw) await globalThis.dmw.setTheme(value);
      try { localStorage.setItem(key, value); }
      catch { if (!globalThis.dmw) throw new Error('Браузер не разрешает сохранить выбор темы.'); }
      preference = value;
      apply();
    },
  });
  apply();
})();
