// Scene for the Root skin (Eywa and the Tree of Souls). Built once, lazily, the first time the skin is active, so
// Classic and Co-pilot never download the artwork. Only fixed asset paths are used; sizes, positions and timings
// come from _skin-root.scss (nth-child loops), so there are no inline styles. Mood changes are CSS only: core-strip.vue
// sets data-mood on <html>.

const SLICES = 11;
const TREE_LAYERS = 4;
const HAZE = 34;
const HORIZON_MOSS = 40;
const GROUND_MOSS = 80;
const DOTS = 50;
const SEEDS = 22;
const ORBS = 3;

let isBuilt = false;

function box(tag: string, className: string, count = 0): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  for (let i = 0; i < count; i++) element.append(document.createElement('span'));
  return element;
}

function img(file: string, className: string): HTMLImageElement {
  const image = document.createElement('img');
  image.src = `/root/${file}.svg`;
  image.alt = '';
  image.className = className;
  image.decoding = 'async';
  image.draggable = false;
  return image;
}

function hidden<T extends HTMLElement>(element: T): T {
  element.setAttribute('aria-hidden', 'true');
  return element;
}

/** A seed of Eywa: a halo, a rig of 11 rotated strand slices, and a fixed body. The same files are reused everywhere, so the browser caches them. */
export function buildSprite(): HTMLElement {
  const sprite = box('div', 'rs-sprite');
  const rig = box('div', 'rs-sprite__rig');
  for (let i = 1; i <= SLICES; i++) rig.append(img(`seed-${i}`, 'rs-sprite__img'));
  sprite.append(box('div', 'rs-sprite__halo'), rig, img('seed-body', 'rs-sprite__img'));
  return sprite;
}

/** Puts the big central seed into the core strip (the core markup is built by core-strip.vue). Safe to call repeatedly. */
function fillCoreSeed(): void {
  const slot = document.querySelector('#core .core__seed');
  if (!slot || slot.childElementCount > 0) return;
  const pulse = box('div', 'rs-pulse');
  pulse.append(buildSprite());
  slot.append(pulse);
}

function seed(): HTMLElement {
  const outer = box('div', 'rs-seed');
  const float = box('div', 'rs-seed__float');
  const scale = box('div', 'rs-seed__scale');
  const thrust = box('div', 'rs-seed__thrust');
  const pulse = box('div', 'rs-pulse');
  pulse.append(buildSprite());
  thrust.append(pulse);
  scale.append(thrust);
  float.append(scale);
  outer.append(float);
  return outer;
}

function buildHero(): HTMLElement {
  const hero = hidden(box('div', 'rs-hero'));
  const sway = box('div', 'rs-stage rs-sway');
  sway.append(img('tree-glow', 'rs-layer rs-glow'));
  for (let i = 1; i <= TREE_LAYERS; i++) sway.append(img(`tree-${i}`, 'rs-layer rs-shimmer'));

  const reflectIn = box('div', 'rs-reflect__in');
  reflectIn.append(img('tree-glow', 'rs-layer'));
  const reflect = box('div', 'rs-stage rs-reflect');
  reflect.append(reflectIn);

  hero.append(
    img('curtain', 'rs-curtain'),
    box('div', 'rs-mist'),
    box('div', 'rs-haze', HAZE),
    img('limbs', 'rs-stage rs-limbs'),
    sway,
    box('div', 'rs-dim'),
    box('div', 'rs-listen'),
    box('div', 'rs-orbs', ORBS),
    box('div', 'rs-baseglow'),
    box('div', 'rs-ground'),
    box('div', 'rs-horizon'),
    box('div', 'rs-moss rs-moss--horizon', HORIZON_MOSS),
    reflect,
  );
  return hero;
}

function buildFx(): HTMLElement {
  const fx = hidden(box('div', 'rs-fx'));
  const seeds = box('div', 'rs-seeds');
  for (let i = 0; i < SEEDS; i++) seeds.append(seed());
  fx.append(box('div', 'rs-moss rs-moss--ground', GROUND_MOSS), box('div', 'rs-dots', DOTS), seeds);
  return fx;
}

/** Builds the scene once. Called when the Root skin becomes active (and at startup if it is the saved skin). */
export function ensureRootScene(): void {
  if (!isBuilt) {
    isBuilt = true;
    document.body.append(buildHero(), buildFx());
  }
  fillCoreSeed();
}
