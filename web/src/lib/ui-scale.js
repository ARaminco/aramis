import { ref } from 'vue';

const KEY = 'aramis_ui_scale';
const MIN = 0.8;
const MAX = 1.5;
const STEP = 0.05;

function clamp(v) { return Math.max(MIN, Math.min(MAX, Math.round(v * 100) / 100)); }

function apply(scale) {
  // Tailwind uses rem; scaling the root font-size scales everything proportionally.
  document.documentElement.style.fontSize = (16 * scale) + 'px';
}

const stored = Number(localStorage.getItem(KEY));
export const scale = ref(Number.isFinite(stored) && stored >= MIN && stored <= MAX ? stored : 1);
apply(scale.value);

export function setScale(v) {
  scale.value = clamp(v);
  apply(scale.value);
  localStorage.setItem(KEY, String(scale.value));
}

export function bumpScale(delta) { setScale(scale.value + delta); }
export function resetScale() { setScale(1); }

export const SCALE_STEP = STEP;
export const SCALE_MIN = MIN;
export const SCALE_MAX = MAX;
