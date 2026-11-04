(() => {
  const key = '3det-adaptavel-theme-v1';
  const system = window.matchMedia?.('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem(key); } catch {}
  if (!['light', 'dark'].includes(preference)) preference = null;
  function apply() {
    const dark = preference ? preference === 'dark' : Boolean(system?.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const button = document.querySelector('#theme-toggle');
    if (button) {
      button.textContent = dark ? '☀ Modo claro' : '☾ Modo noturno';
      button.setAttribute('aria-label', dark ? 'Ativar modo claro' : 'Ativar modo noturno');
      button.setAttribute('aria-pressed', String(dark));
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e1718' : '#143d39');
  }
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelector('#theme-toggle')?.addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, preference); } catch {}
      apply();
    });
  });
  system?.addEventListener?.('change', () => { if (!preference) apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = ['dark', 'light'].includes(event.newValue) ? event.newValue : null;
    apply();
  });
})();
