import './style.css';

declare const __APP_VERSION__: string;

console.log(`[init] version=${__APP_VERSION__}`);

const footerVersion = document.getElementById('version');
if (footerVersion) footerVersion.textContent = `web v${__APP_VERSION__}`;

const fields = (key: string) => document.querySelector<HTMLElement>(`#device [data-k="${key}"]`);

function renderDevice() {
  const values: Record<string, string> = {
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    dpr: `${window.devicePixelRatio}×`,
    orientation: window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait',
    scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    pointer: matchMedia('(pointer: coarse)').matches ? 'touch' : 'fine',
    version: __APP_VERSION__,
  };
  for (const [key, value] of Object.entries(values)) {
    const el = fields(key);
    if (el) el.textContent = value;
  }
}

renderDevice();
window.addEventListener('resize', renderDevice);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderDevice);

// Tap a code block to copy it.
for (const pre of document.querySelectorAll<HTMLPreElement>('pre')) {
  pre.title = 'Click to copy';
  pre.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.innerText);
      pre.dataset.copied = 'true';
      setTimeout(() => delete pre.dataset.copied, 1200);
    } catch {
      // Clipboard needs a secure context; ignore on plain-http LAN dev.
    }
  });
}
