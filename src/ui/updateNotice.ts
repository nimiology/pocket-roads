/** How often a running game checks whether a newer version has been deployed. */
const CHECK_EVERY = 5 * 60 * 1000;

/**
 * Watches for a new deployment and offers a reload. Production only: the build writes
 * version.json, and the game compares it with the build it was loaded from.
 */
export function watchForUpdates(parent: HTMLElement): void {
  if (import.meta.env.DEV) return;
  const el = document.createElement('div');
  el.className = 'update-notice';
  el.hidden = true;
  el.innerHTML = `<span>✨ A new update is out!</span><button class="reload">Update</button><button class="later" aria-label="Dismiss">✕</button>`;
  el.querySelector('.reload')!.addEventListener('click', () => location.reload());
  el.querySelector('.later')!.addEventListener('click', () => { el.hidden = true; });
  parent.appendChild(el);

  let found = false;
  const check = async () => {
    if (found) return;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { build } = await res.json();
      if (build && build !== __BUILD_ID__) {
        found = true;
        el.hidden = false;
      }
    } catch { /* offline: try again later */ }
  };
  setInterval(check, CHECK_EVERY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
