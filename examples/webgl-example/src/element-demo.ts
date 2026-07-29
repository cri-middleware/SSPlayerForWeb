import { defineSSPlayerElement, SSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
import { SSRuntimeManager } from '@spritestudio/ssplayer-webgl';

// Register <ss-player>. This upgrades the element already in the HTML, whose
// connectedCallback then loads its `src`/`autoplay` attributes.
defineSSPlayerElement();

// Bundled sample ssabs served from public/. The deploy nests each project under
// public/<project>/ (ssconverter --stem-dir); map a bare name to its URL
// (relative, so the <ss-player src> resolves siblings from the same folder).
const BUNDLED_SSABS = [
  'Basic.ssab', 'Shape.ssab', 'PartsColor.ssab', 'Mesh.ssab', 'Ringo.ssab',
  'Effect.ssab', 'Mask.ssab', 'Instance.ssab', 'BlendMode.ssab', 'Shader.ssab',
];
const ssabUrl = (name: string) => (name.startsWith('Ringo') ? 'Ringo/' : 'overall/') + name;

const player = document.getElementById('player') as SSPlayerElement;
const ssabSel = document.getElementById('ssab') as HTMLSelectElement;
const animSel = document.getElementById('anim') as HTMLSelectElement;
const speed = document.getElementById('speed') as HTMLInputElement;
const spd = document.getElementById('spd') as HTMLElement;
const log = document.getElementById('log') as HTMLElement;
const snippet = document.getElementById('snippet') as HTMLElement;
const copyBtn = document.getElementById('copy') as HTMLButtonElement;

const write = (msg: string) => {
  log.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n${log.textContent}`;
};

// Live snippet reflecting the current attributes — copy-pasteable declarative usage.
// Uses textContent so the <ss-player> / <script> tags render as literal text.
function renderSnippet(): void {
  const src = player.getAttribute('src') ?? '';
  // The element auto-picks the first animation when the attribute is unset; show that
  // concrete name (from the dropdown) so the snippet is explicit and copy-ready.
  const anim = player.getAttribute('animation') || animSel.value;
  const speedVal = player.getAttribute('speed');
  const attrs = [`src="${src}"`];
  if (anim) attrs.push(`animation="${anim}"`);
  attrs.push('autoplay');
  if (speedVal && Number(speedVal) !== 1) attrs.push(`speed="${speedVal}"`);
  snippet.textContent =
`<script type="module">
  import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
  defineSSPlayerElement();
</script>

<ss-player ${attrs.join(' ')}
           style="width:480px;height:480px"></ss-player>`;
}

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard?.writeText(snippet.textContent ?? '');
  copyBtn.textContent = 'copied!';
  setTimeout(() => { copyBtn.textContent = 'copy'; }, 1200);
});

for (const name of BUNDLED_SSABS) {
  const opt = document.createElement('option');
  opt.value = ssabUrl(name);
  opt.textContent = name;
  ssabSel.appendChild(opt);
}
ssabSel.value = ssabUrl('Basic.ssab');

// The element auto-selects the first animation; we still fetch the ssab once to
// populate the dropdown (mirrors main.ts — no instance-level name accessor).
async function populateAnimations(url: string): Promise<void> {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const anims = SSRuntimeManager.extractAnimationNames(buf);
  animSel.innerHTML = '';
  for (const name of anims) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    animSel.appendChild(opt);
  }
  animSel.disabled = anims.length === 0;
  renderSnippet();
}

// Element CustomEvents. `load`/`error` fire today; `ended`/`loop`/`userdata`/`signal`
// are wired but inert until the SSPlayer P0 event work lands.
for (const type of ['load', 'ended', 'loop', 'userdata', 'signal', 'error']) {
  player.addEventListener(type, (e: Event) => {
    const detail = (e as CustomEvent).detail;
    write(`event: ${type}${detail !== undefined ? ' ' + JSON.stringify(detail) : ''}`);
  });
}

// Switch ssab reactively via the `src` attribute; clear `animation` so the element
// falls back to the first animation of the new ssab.
ssabSel.addEventListener('change', async () => {
  player.removeAttribute('animation');
  player.setAttribute('src', ssabSel.value);
  await populateAnimations(ssabSel.value);
});

animSel.addEventListener('change', () => {
  player.setAttribute('animation', animSel.value);
  renderSnippet();
});

document.getElementById('play')!.addEventListener('click', () => player.play());
document.getElementById('pause')!.addEventListener('click', () => player.pause());
document.getElementById('stop')!.addEventListener('click', () => player.stop());

speed.addEventListener('input', () => {
  spd.textContent = Number(speed.value).toFixed(1);
  player.setAttribute('speed', speed.value);
  renderSnippet();
});

populateAnimations(ssabUrl('Basic.ssab')).catch((e) => write(`Error: ${e?.message ?? e}`));
