// Material 3 の配色。シード色からライト／ダークのカラースキームを作り、CSS 変数（--md-sys-color-*）として流し込む。

import { Hct, hexFromArgb, MaterialDynamicColors, SchemeTonalSpot } from '@material/material-color-utilities';

export type ThemeMode = 'auto' | 'light' | 'dark';

const SEED = 0xff4285f4; // Google Blue
const STORAGE_KEY = 'sekigae:theme';
const media = matchMedia('(prefers-color-scheme: dark)');
const colors = new MaterialDynamicColors().allColors;

const buildCss = (isDark: boolean) => {
	const scheme = new SchemeTonalSpot(Hct.fromInt(SEED), isDark, 0);
	return colors.map((c) => `--md-sys-color-${c.name.replaceAll('_', '-')}: ${hexFromArgb(c.getArgb(scheme))};`).join('\n');
};

const style = document.createElement('style');
style.textContent = `:root { color-scheme: light; ${buildCss(false)} }
:root[data-theme="dark"] { color-scheme: dark; ${buildCss(true)} }`;
document.head.append(style);

const readMode = (): ThemeMode => {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === 'light' || v === 'dark' ? v : 'auto';
	} catch {
		return 'auto';
	}
};

let mode = readMode();

const apply = () => {
	const dark = mode === 'dark' || (mode === 'auto' && media.matches);
	document.documentElement.dataset.theme = dark ? 'dark' : 'light';
	document
		.querySelector('meta[name="theme-color"]')
		?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-surface').trim());
};

media.addEventListener('change', apply);
apply();

export const getThemeMode = () => mode;

export function cycleThemeMode(): ThemeMode {
	mode = mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto';
	try {
		localStorage.setItem(STORAGE_KEY, mode);
	} catch {
		// 保存できなくても、このページの間は切り替わる
	}
	apply();
	return mode;
}

const cardCache = new Map<number, string>();

/** 出席番号ごとのカードの色（同じ色相のトーン違いで、ライト／ダーク両方の分を CSS 変数で返す） */
export function studentColorVars(n: number): string {
	let v = cardCache.get(n);
	if (!v) {
		const hue = (n * 137.508) % 360;
		const tone = (t: number, chroma = 40) => hexFromArgb(Hct.from(hue, chroma, t).toInt());
		v = `--h:${hue.toFixed(1)};--cl-bg:${tone(92)};--cl-fg:${tone(15)};--cl-ol:${tone(78)};--cd-bg:${tone(30)};--cd-fg:${tone(92)};--cd-ol:${tone(50)}`;
		cardCache.set(n, v);
	}
	return v;
}
