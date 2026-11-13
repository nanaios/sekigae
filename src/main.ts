import '@material/web/button/filled-button.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/button/text-button.js';
import '@material/web/checkbox/checkbox.js';
import '@material/web/divider/divider.js';
import '@material/web/elevation/elevation.js';
import '@material/web/focus/md-focus-ring.js';
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';
import '@material/web/ripple/ripple.js';
import '@material/web/switch/switch.js';
import '@material/web/textfield/outlined-text-field.js';
import { html, nothing, render, type TemplateResult } from 'lit-html';
import { classMap } from 'lit-html/directives/class-map.js';
import { live } from 'lit-html/directives/live.js';
import { repeat } from 'lit-html/directives/repeat.js';
import { createSecretCounter, DOPA_EMOJI, HYPE, RARITY_POINTS, RARITY_RANK, type Rarity, seatRarities, tickerText } from './dopagaki';
import { banner, comboHide, comboShow, confetti, flash, floatText, GOLD, shake, sfx, sleep, sound, vibrate } from './fx';
import {
	activePins,
	type Arrangement,
	buildForbidden,
	clampInt,
	LIMITS,
	normalizeArrangement,
	parseSeatKey,
	pruneConfig,
	scrambleArrangement,
	type SeatKey,
	seatKey,
	seatLabel,
	shuffleInPlace,
	shuffleSeats,
	studentNumbers,
	usableSeats,
} from './model';
import {
	fileStamp,
	formatDateTime,
	type HistoryEntry,
	makeRecord,
	mergeHistory,
	parseSeatFile,
	serializeHistory,
	serializeSeating,
} from './seatfile';
import { type AppState, loadState, saveState, type Speed } from './store';
import { cycleThemeMode, getThemeMode, studentColorVars, type ThemeMode } from './theme';
import './style.css';

const app = document.getElementById('app')!;
let state: AppState = loadState();
let unseated: number[] = [];

interface Toast {
	id: number;
	text: string;
	kind: 'info' | 'error' | 'success';
}

const ui = {
	busy: false,
	popover: null as null | { key: SeatKey; x: number; y: number; above: boolean },
	pinInput: '',
	toasts: [] as Toast[],
	dopa: false,
	facedown: false,
	revealed: new Set<number>(),
	showSkip: false,
	skip: false,
	landed: false,
	dragging: false,
};

function normalize() {
	const r = normalizeArrangement(state.config, state.arrangement);
	state.arrangement = r.arrangement;
	unseated = r.unseated;
}

function update() {
	render(view(), app);
}

// ---------------- FLIP アニメーション ----------------

interface FlipOpts {
	duration: number;
	lift?: number;
	stagger?: number;
	spin?: boolean;
}

const gridEl = () => app.querySelector<HTMLElement>('.grid');

function measureCards(): Map<number, DOMRect> {
	const m = new Map<number, DOMRect>();
	app.querySelectorAll<HTMLElement>('.card[data-num]').forEach((el) => m.set(Number(el.dataset.num), el.getBoundingClientRect()));
	return m;
}

function flipFrom(before: Map<number, DOMRect>, o: FlipOpts): Promise<void> {
	const g = gridEl();
	if (!g) return Promise.resolve();
	const jobs: Promise<unknown>[] = [];
	let i = 0;
	for (const el of g.querySelectorAll<HTMLElement>('.card[data-num]')) {
		const a = before.get(Number(el.dataset.num));
		if (!a) {
			jobs.push(
				el.animate([{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1)' }], { duration: o.duration, easing: 'ease-out' })
					.finished,
			);
			continue;
		}
		const b = el.getBoundingClientRect();
		const dx = a.left - b.left;
		const dy = a.top - b.top;
		if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
		const lift = o.lift ?? 0;
		const spin = o.spin ? 360 : 0;
		el.classList.add('moving');
		const anim = el.animate(
			[
				{ transform: `translate(${dx}px, ${dy}px) scale(1) rotate(0deg)` },
				{ transform: `translate(${dx / 2}px, ${dy / 2 - lift}px) scale(${1 + lift / 150}) rotate(${spin / 2}deg)`, offset: 0.5 },
				{ transform: `translate(0px, 0px) scale(1) rotate(${spin}deg)` },
			],
			// Material の「強調」イージング
			{ duration: o.duration, delay: (o.stagger ?? 0) * i++, easing: 'cubic-bezier(.2,0,0,1)', fill: 'backwards' },
		);
		const done = () => el.classList.remove('moving');
		jobs.push(anim.finished.then(done, done));
	}
	return Promise.all(jobs).then(
		() => undefined,
		() => undefined,
	);
}

async function flipTo(next: Arrangement, o: FlipOpts) {
	const before = measureCards();
	state.arrangement = next;
	update();
	await flipFrom(before, o);
}

// ---------------- 状態の更新 ----------------

function commit(mutate: (s: AppState) => void, opts: { animate?: boolean; keepKind?: boolean } = {}) {
	const before = opts.animate && state.speed !== 'off' ? measureCards() : null;
	const prev = JSON.stringify([...state.arrangement]);
	mutate(state);
	pruneConfig(state.config);
	normalize();
	if (!opts.keepKind && JSON.stringify([...state.arrangement]) !== prev) {
		state.savedId = null;
		if (state.kind !== 'order') state.kind = 'edited';
	}
	saveState(state);
	update();
	if (before) void flipFrom(before, { duration: 420, lift: 8 });
}

let toastSeq = 0;
function toast(text: string, kind: Toast['kind'] = 'info') {
	const t: Toast = { id: ++toastSeq, text, kind };
	ui.toasts = [...ui.toasts, t].slice(-3);
	update();
	setTimeout(
		() => {
			ui.toasts = ui.toasts.filter((x) => x !== t);
			update();
		},
		kind === 'error' ? 8000 : 4500,
	);
}

function setDim(which: 'rows' | 'cols', v: number) {
	if (!Number.isFinite(v)) return update();
	const lim = LIMITS[which];
	commit((s) => {
		s.config[which] = clampInt(v, lim.min, lim.max);
	}, { animate: true });
}

function setCount(v: number) {
	if (!Number.isFinite(v)) return update();
	commit((s) => {
		s.config.studentCount = clampInt(v, LIMITS.students.min, LIMITS.students.max);
	}, { animate: true });
}

/** 「12, 25」「3-5」「１２」などを番号の配列に */
function parseNumberList(text: string): number[] {
	const half = text.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
	const out: number[] = [];
	for (const part of half.split(/[\s,、，・]+/)) {
		const m = part.match(/^(\d+)(?:[-~〜－ー](\d+))?$/);
		if (!m) continue;
		const a = Number(m[1]);
		const b = m[2] ? Number(m[2]) : a;
		for (let n = Math.min(a, b); n <= Math.max(a, b) && out.length < 200; n++) out.push(n);
	}
	return out;
}

function setMissing(text: string) {
	commit((s) => {
		s.config.missing = parseNumberList(text);
	}, { animate: true });
}

function toggleDisabled(k: SeatKey) {
	closePopover();
	commit((s) => {
		const off = new Set(s.config.disabled);
		if (off.has(k)) off.delete(k);
		else {
			off.add(k);
			delete s.config.pins[k];
		}
		s.config.disabled = [...off];
	}, { animate: true });
	if (unseated.length) toast(`席が ${unseated.length} 席足りなくなりました`, 'error');
}

function pinSeat(k: SeatKey, n: number) {
	closePopover();
	commit((s) => {
		for (const [pk, pn] of Object.entries(s.config.pins)) if (pn === n || pk === k) delete s.config.pins[pk];
		s.config.pins[k] = n;
		// いまの並びでも入れ替えておく（n が座っていた席に、k に座っていた人を移す）
		const from = [...s.arrangement].find(([, v]) => v === n)?.[0];
		const occupant = s.arrangement.get(k);
		if (from !== k) {
			if (from) s.arrangement.delete(from);
			if (from && occupant !== undefined) s.arrangement.set(from, occupant);
			s.arrangement.set(k, n);
		}
	}, { animate: true });
}

function pinFromInput(k: SeatKey) {
	const [n] = parseNumberList(ui.pinInput);
	const enrolled = new Set(studentNumbers(state.config));
	if (!n || !enrolled.has(n)) {
		toast(n ? `${n} 番はいません（出席番号 1〜${state.config.studentCount}、欠番を除く）` : '出席番号を入れてください', 'error');
		return;
	}
	pinSeat(k, n);
	toast(`${n} 番を ${seatLabel(k)} に固定しました`, 'success');
}

function unpin(k: SeatKey) {
	closePopover();
	commit((s) => {
		delete s.config.pins[k];
	});
}

function loadEntry(e: HistoryEntry, quiet = false) {
	commit(
		(s) => {
			Object.assign(s.config, {
				rows: e.rows,
				cols: e.cols,
				disabled: [...e.disabled],
				windowSide: e.windowSide,
				studentCount: e.studentCount,
				missing: [...e.missing],
			});
			s.arrangement = new Map(e.seats.map((x) => [seatKey(x.row, x.col), x.number]));
			s.kind = 'loaded';
			s.at = e.createdAt;
			s.savedId = e.id;
		},
		{ animate: true, keepKind: true },
	);
	if (!quiet) toast(`「${e.title}」を今の席として表示しました`);
}

async function importFiles(files: Iterable<File>) {
	const recs = [];
	const errors: string[] = [];
	for (const f of files) {
		try {
			recs.push(...parseSeatFile(await f.text()));
		} catch (err) {
			errors.push(`${f.name}：${(err as Error).message}`);
		}
	}
	if (recs.length) {
		const fresh = state.kind === 'order';
		const res = mergeHistory(state.history, recs);
		commit((s) => {
			s.history = res.history;
		});
		let msg = `${res.added} 件の席順を読み込みました`;
		if (res.duplicates) msg += `（${res.duplicates} 件は読み込み済み）`;
		if (res.dropped.length) msg += `。上限 10 件のため、古い ${res.dropped.length} 件を外しました`;
		toast(msg, 'success');
		if (fresh && res.added > 0) {
			loadEntry(res.history[0], true);
			toast(`いちばん新しい「${res.history[0].title}」を今の席として表示しました`);
		}
	}
	for (const m of errors) toast(m, 'error');
}

function download(name: string, text: string) {
	const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const sameSeats = (e: HistoryEntry, arr: Arrangement) =>
	e.seats.length === arr.size && e.seats.every((x) => arr.get(seatKey(x.row, x.col)) === x.number);

function saveCurrent() {
	if (ui.busy) return;
	let rec: HistoryEntry | undefined = state.history.find((h) => h.id === state.savedId);
	if (rec && !sameSeats(rec, state.arrangement)) rec = undefined;
	if (rec) {
		download(`sekigae_${fileStamp(new Date(rec.createdAt))}.json`, serializeSeating(rec));
		toast('同じ席順をもう一度保存しました', 'success');
		return;
	}
	const created = makeRecord(state.config, state.arrangement, state.kind === 'shuffled' && state.at ? new Date(state.at) : new Date());
	download(`sekigae_${fileStamp(new Date(created.createdAt))}.json`, serializeSeating(created));
	const res = mergeHistory(state.history, [created]);
	commit(
		(s) => {
			s.history = res.history;
			s.savedId = created.id;
		},
		{ keepKind: true },
	);
	toast(
		res.dropped.length
			? `ファイルに保存し、「前回までの席」に追加しました（上限 10 件のため古い ${res.dropped.length} 件を外しました）`
			: 'ファイルに保存し、「前回までの席」にも追加しました',
		'success',
	);
}

// ---------------- 席替え ----------------

async function doShuffle() {
	if (ui.busy) return;
	closePopover();
	if (unseated.length) {
		toast(`席が ${unseated.length} 席足りません。席を増やすか、人数を見直してください。`, 'error');
		return;
	}
	const forbidden = state.avoidHistory ? buildForbidden(state.history.filter((e) => e.enabled)) : new Map();
	const res = shuffleSeats(state.config, forbidden);
	if (!res.ok) {
		toast(res.message, 'error');
		return;
	}
	ui.busy = true;
	update();
	try {
		if (ui.dopa) await dopaShuffle(res.arrangement);
		else await normalShuffle(res.arrangement);
	} finally {
		state.arrangement = res.arrangement;
		state.kind = 'shuffled';
		state.at = new Date().toISOString();
		state.savedId = null;
		normalize();
		saveState(state);
		ui.busy = false;
		ui.facedown = false;
		ui.showSkip = false;
		update();
	}
}

async function normalShuffle(final: Arrangement) {
	const sp: Speed = state.speed;
	if (sp === 'off') return;
	const normal = sp === 'normal';
	for (let i = 0; i < (normal ? 3 : 1); i++) {
		await flipTo(scrambleArrangement(state.config, state.arrangement), { duration: normal ? 430 : 260, lift: 22 });
	}
	await flipTo(final, { duration: normal ? 760 : 420, lift: 30, stagger: normal ? 22 : 6 });
	ui.landed = true;
	update();
	await sleep(600);
	ui.landed = false;
}

async function dopaShuffle(final: Arrangement) {
	const cfg = state.config;
	const rarity = seatRarities(cfg);
	const pinned = new Set(activePins(cfg).values());
	ui.revealed = new Set(pinned);
	ui.skip = false;
	sfx.start();
	vibrate(60);
	shake(app, 8, 450);
	void banner('席替えガチャ', 'rainbow', 1100, 'START!!');
	ui.facedown = true;
	update();
	await sleep(520);
	sfx.drumroll(2.3);
	for (let i = 0; i < 6; i++) {
		sfx.whoosh();
		await flipTo(scrambleArrangement(cfg, state.arrangement), { duration: 300, lift: 36, spin: i % 2 === 0 });
	}
	sfx.hype();
	flash('gold', 450);
	shake(app, 12, 500);
	await banner(HYPE[Math.floor(Math.random() * HYPE.length)], 'gold', 1150);
	await flipTo(final, { duration: 650, lift: 46, stagger: 12 });

	// 1 人ずつ発表（レア度の低い席から）
	ui.showSkip = true;
	update();
	const order = shuffleInPlace(
		[...final].filter(([, n]) => !pinned.has(n)).map(([k, n]) => ({ k, n, r: rarity.get(k) ?? ('N' as Rarity) })),
		Math.random,
	).sort((a, b) => RARITY_RANK[a.r] - RARITY_RANK[b.r]);
	let combo = 0;
	for (const item of order) {
		if (ui.skip) break;
		combo++;
		ui.revealed.add(item.n);
		update();
		const rc = app.querySelector(`.card[data-num="${item.n}"]`)?.getBoundingClientRect();
		const x = rc ? rc.left + rc.width / 2 : innerWidth / 2;
		const y = rc ? rc.top + rc.height / 2 : innerHeight / 2;
		comboShow(combo);
		if (item.r === 'UR') {
			sfx.ur();
			vibrate([80, 40, 160, 40, 260]);
			flash('rainbow', 900);
			shake(app, 16, 900);
			confetti({ x, y, count: 170, power: 15 });
			await banner('主人公席 確定!!', 'ur', 2300, `${item.n} 番 おめでとう!!`);
		} else if (item.r === 'SSR') {
			sfx.rare();
			flash('gold', 260);
			confetti({ x, y, count: 50, power: 8, colors: GOLD });
			floatText(x, y, 'SSR 神席!!', 'ssr');
			vibrate(40);
			await sleep(380);
		} else {
			sfx.tick(combo);
			floatText(x, y, `+${RARITY_POINTS[item.r]}`, item.r.toLowerCase());
			if (item.r === 'SR') confetti({ x, y, count: 14, power: 5 });
			await sleep(Math.max(55, 190 - combo * 7));
		}
	}
	ui.showSkip = false;
	for (const o of order) ui.revealed.add(o.n);
	ui.facedown = false;
	update();
	comboHide();
	const score = order.reduce((s, o) => s + RARITY_POINTS[o.r], 0);
	sfx.fanfare();
	confetti({ x: innerWidth * 0.15, y: innerHeight * 0.85, angle: -Math.PI / 3, spread: 0.9, count: 130, power: 17 });
	confetti({ x: innerWidth * 0.85, y: innerHeight * 0.85, angle: (-2 * Math.PI) / 3, spread: 0.9, count: 130, power: 17 });
	await banner('コンプリート!!', 'rainbow', 1700, `ドーパミン +${score.toLocaleString()}`);
}

// ---------------- ないしょのモード ----------------

function toggleDopa() {
	if (ui.busy) return;
	ui.dopa = !ui.dopa;
	document.documentElement.classList.toggle('dopa', ui.dopa);
	update();
	if (ui.dopa) {
		sfx.on();
		flash('rainbow', 700);
		shake(app, 14, 700);
		confetti({ count: 200, power: 16 });
		vibrate([50, 30, 50, 30, 120]);
		void banner('ドパガキモード', 'rainbow', 1900, '解禁!!');
	} else {
		sfx.off();
		toast('通常モードに戻りました');
	}
}

const secretHit = createSecretCounter(toggleDopa);
addEventListener('keydown', (e) => {
	if (e.key === 'Shift' && !e.repeat) secretHit();
	if (e.key === 'Escape' && ui.popover) closePopover();
});

// ---------------- 席のメニュー ----------------

function openPopover(k: SeatKey, el: HTMLElement) {
	if (ui.busy) return;
	if (ui.popover?.key === k) return closePopover();
	const r = el.getBoundingClientRect();
	const above = r.bottom + 320 > innerHeight && r.top > 320;
	ui.popover = { key: k, x: Math.min(Math.max(r.left + r.width / 2, 160), innerWidth - 160), y: above ? r.top - 8 : r.bottom + 8, above };
	ui.pinInput = '';
	update();
	app.querySelector<HTMLElement>('.popover .menu-item')?.focus({ preventScroll: true });
}

function closePopover() {
	if (!ui.popover) return;
	ui.popover = null;
	update();
}

document.addEventListener('pointerdown', (e) => {
	if (!ui.popover) return;
	const t = e.target as Element;
	if (t.closest('.popover') || t.closest('.seat')) return;
	closePopover();
});
// 画面が動いたらメニューを閉じる。ただし入力中（スマホのキーボード表示で画面が動く）は閉じない
const closeUnlessTyping = () => {
	if (!app.querySelector('.popover')?.contains(document.activeElement)) closePopover();
};
addEventListener('resize', closeUnlessTyping);
addEventListener('scroll', closeUnlessTyping, { passive: true, capture: true });

// ファイルをドロップして読み込み
addEventListener('dragover', (e) => {
	if (!e.dataTransfer?.types.includes('Files')) return;
	e.preventDefault();
	if (!ui.dragging) {
		ui.dragging = true;
		update();
	}
});
addEventListener('dragleave', (e) => {
	if (e.relatedTarget === null && ui.dragging) {
		ui.dragging = false;
		update();
	}
});
addEventListener('drop', (e) => {
	if (!e.dataTransfer?.files.length) return;
	e.preventDefault();
	ui.dragging = false;
	update();
	void importFiles(e.dataTransfer.files);
});

// ---------------- 表示（Material 3） ----------------

const icon = (name: string, slot?: string) => html`<md-icon slot=${slot ?? nothing} aria-hidden="true">${name}</md-icon>`;

const logo = html`<svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
	<rect x="2" y="3" width="28" height="5" rx="2" class="logo-board" />
	<rect x="4" y="12" width="7" height="6" rx="1.6" class="logo-a" />
	<rect x="12.5" y="12" width="7" height="6" rx="1.6" class="logo-b" />
	<rect x="21" y="12" width="7" height="6" rx="1.6" class="logo-a" />
	<rect x="4" y="21" width="7" height="6" rx="1.6" class="logo-b" />
	<rect x="12.5" y="21" width="7" height="6" rx="1.6" class="logo-a" />
	<rect x="21" y="21" width="7" height="6" rx="1.6" class="logo-b" />
</svg>`;

const THEME_ICON: Record<ThemeMode, string> = { auto: 'brightness_auto', light: 'light_mode', dark: 'dark_mode' };
const THEME_LABEL: Record<ThemeMode, string> = { auto: 'テーマ：自動（端末に合わせる）', light: 'テーマ：ライト', dark: 'テーマ：ダーク' };

function onCycleTheme() {
	const m = cycleThemeMode();
	update();
	toast(THEME_LABEL[m]);
}

function view(): TemplateResult {
	const tm = getThemeMode();
	return html`
		${ui.dopa ? dopaLayer() : nothing}
		<header class="top-app-bar">
			<button class="brand" type="button" @click=${secretHit} aria-label="席替え">
				<md-ripple></md-ripple>
				<md-focus-ring></md-focus-ring>
				${logo}
			</button>
			<div class="app-title">
				<span class="title">${ui.dopa ? '席替えガチャ' : '席替え'}</span>
				<span class="subtitle">${ui.dopa ? 'DOPAGAKI MODE' : 'SEKIGAE'}</span>
			</div>
			<div class="app-actions">
				<md-icon-button @click=${onCycleTheme} title=${THEME_LABEL[tm]} aria-label=${THEME_LABEL[tm]}>${icon(THEME_ICON[tm])}</md-icon-button>
				<md-icon-button @click=${openFullscreen} title="全画面で表示" aria-label="全画面で表示">${icon('fullscreen')}</md-icon-button>
				<md-icon-button @click=${() => window.print()} title="印刷" aria-label="印刷">${icon('print')}</md-icon-button>
			</div>
		</header>
		${ui.dopa
			? html`<div class="ticker" aria-hidden="true">
					<div class="ticker-track">
						<span>${tickerText(usableSeats(state.config).length)}</span><span>${tickerText(usableSeats(state.config).length)}</span>
					</div>
				</div>`
			: nothing}
		<main class="layout">
			<section class="stage">${stageHead()} ${boardView()} ${actionsView()}</section>
			<aside class="panel">
				${layoutPanel()} ${studentsPanel()} ${pinsPanel()} ${historyPanel()} ${optionsPanel()}
				<p class="privacy">${icon('lock')}<span>データはこのブラウザの中と、保存したファイルにだけ残ります。サーバーには送信しません。</span></p>
			</aside>
		</main>
		${popoverView()}
		<div class="snackbars" role="status" aria-live="polite">
			${repeat(
				ui.toasts,
				(t) => t.id,
				(t) =>
					html`<div class="snackbar ${t.kind}">${icon(t.kind === 'error' ? 'warning' : t.kind === 'success' ? 'check_circle' : 'info')}<span>${t.text}</span></div>`,
			)}
		</div>
		${ui.showSkip ? html`<button class="skip" type="button" @click=${() => (ui.skip = true)}>スキップ ${icon('fast_forward')}</button>` : nothing}
		${ui.dopa
			? html`<button class="mute" type="button" @click=${toggleMute} aria-label="音のオン・オフ">${icon(sound.muted ? 'volume_off' : 'volume_up')}</button>`
			: nothing}
		${ui.dragging ? html`<div class="dropzone">${icon('upload_file')}<span>ここにドロップして「前回までの席」に読み込み</span></div>` : nothing}
	`;
}

function dopaLayer() {
	return html`<div class="dopa-bg" aria-hidden="true">
		${DOPA_EMOJI.map((e, i) => html`<span style="--i:${i}">${e}</span>`)}
	</div>`;
}

function toggleMute() {
	sound.muted = !sound.muted;
	update();
}

function openFullscreen() {
	const el = app.querySelector('.stage');
	if (!el?.requestFullscreen) return toast('このブラウザでは全画面にできません', 'error');
	el.requestFullscreen().catch(() => toast('全画面にできませんでした', 'error'));
}

/** Material 3 のセグメントボタン（単一選択） */
function segmented<T extends string>(options: [T, string, string?][], value: T, onSelect: (v: T) => void, label: string, wide = false) {
	return html`<div class=${classMap({ segmented: true, wide })} role="radiogroup" aria-label=${label}>
		${options.map(
			([v, text, ic]) => html`<button
				type="button"
				role="radio"
				aria-checked=${v === value ? 'true' : 'false'}
				class=${classMap({ seg: true, selected: v === value })}
				?disabled=${ui.busy}
				@click=${() => v !== value && onSelect(v)}
			>
				<md-ripple></md-ripple>
				<md-focus-ring inward></md-focus-ring>
				${v === value ? icon('check') : ic ? icon(ic) : nothing}
				<span>${text}</span>
			</button>`,
		)}
	</div>`;
}

function currentLabel(): { kind: string; title: string } {
	const at = state.at ? formatDateTime(new Date(state.at)) : '';
	switch (state.kind) {
		case 'order':
			return { kind: 'いまの席', title: '出席番号順' };
		case 'shuffled':
			return { kind: '席替え結果', title: at };
		case 'loaded':
			return { kind: '読み込んだ席順', title: state.history.find((h) => h.id === state.savedId)?.title ?? at };
		case 'edited':
			return { kind: 'いまの席', title: '手直しした席順' };
	}
}

function stageHead() {
	const label = currentLabel();
	const cfg = state.config;
	const pins = activePins(cfg).size;
	return html`<div class="stage-head">
			<div class="now">
				<span class="now-kind">${label.kind}</span>
				<span class="now-title">${label.title}</span>
				${state.savedId ? html`<span class="saved">${icon('check_circle')}保存済み</span>` : nothing}
			</div>
			<div class="stats">
				<span title="生徒">${icon('group')}${studentNumbers(cfg).length}人</span>
				<span title="使える席">${icon('event_seat')}${usableSeats(cfg).length}席</span>
				${pins ? html`<span title="固定">${icon('push_pin')}${pins}人</span>` : nothing}
			</div>
			<div class="print-only print-title">席替え ${label.title}</div>
		</div>
		<div class="view-row">
			${segmented<'student' | 'teacher'>(
				[
					['student', '生徒から見た向き', 'group'],
					['teacher', '先生から見た向き', 'co_present'],
				],
				state.teacherView ? 'teacher' : 'student',
				(v) => commit((s) => void (s.teacherView = v === 'teacher'), { animate: true, keepKind: true }),
				'表示の向き',
			)}
		</div>`;
}

function boardView() {
	const cfg = state.config;
	const tv = state.teacherView;
	const off = new Set(cfg.disabled);
	const pins = activePins(cfg);
	const rarity = ui.dopa ? seatRarities(cfg) : null;
	const seatOfNum = new Map([...state.arrangement].map(([k, n]) => [n, k] as const));
	const place = (r: number, c: number) => (tv ? `grid-row:${cfg.rows - r};grid-column:${cfg.cols - c}` : `grid-row:${r + 1};grid-column:${c + 1}`);
	const seats: TemplateResult[] = [];
	for (let r = 0; r < cfg.rows; r++) {
		for (let c = 0; c < cfg.cols; c++) {
			const k = seatKey(r, c);
			const isOff = off.has(k);
			const who = state.arrangement.get(k);
			const pinned = pins.has(k);
			const rr = rarity?.get(k);
			seats.push(html`<button
				type="button"
				class=${classMap({ seat: true, off: isOff, empty: !isOff && who === undefined, active: ui.popover?.key === k, [`r-${rr}`]: !!rr })}
				style=${place(r, c)}
				data-key=${k}
				?disabled=${ui.busy}
				aria-label=${`${seatLabel(k)}${isOff ? '・使えない席' : who !== undefined ? `・${who}番` : '・空席'}${pinned ? '・固定' : ''}`}
				@click=${(e: Event) => openPopover(k, e.currentTarget as HTMLElement)}
			>
				<md-ripple></md-ripple>
				${isOff ? html`<md-icon class="off-mark" aria-hidden="true">block</md-icon>` : who === undefined ? html`<span class="empty-mark">空席</span>` : nothing}
			</button>`);
		}
	}
	const nums = [...seatOfNum.keys()].sort((a, b) => a - b);
	const front = html`<div class="front"><span class="blackboard">黒板</span><span class="desk">教卓</span></div>`;
	const windowLeft = (cfg.windowSide === 'left') !== tv;
	return html`<div class=${classMap({ board: true, teacher: tv, landed: ui.landed })}>
			${tv ? nothing : front}
			<div class="board-mid">
				<div class="side-label ${windowLeft ? 'window' : 'hall'}">${windowLeft ? '窓側' : '廊下側'}</div>
				<div class="grid" style="--rows:${cfg.rows};--cols:${cfg.cols}">
					${seats}
					${repeat(
						nums,
						(n) => n,
						(n) => {
							const k = seatOfNum.get(n)!;
							const { row, col } = parseSeatKey(k);
							const down = ui.facedown && !ui.revealed.has(n);
							const rr = rarity?.get(k);
							return html`<div
								class=${classMap({ card: true, pinned: pins.get(k) === n, down, [`r-${rr}`]: !!rr && !down })}
								data-num=${n}
								style="${place(row, col)};${studentColorVars(n)}"
							>
								<div class="card-inner">
									<div class="card-front">
										<span class="num">${n}</span>
										${pins.get(k) === n ? html`<md-icon class="pin" title="固定">push_pin</md-icon>` : nothing}
										${rr && !down ? html`<span class="rar">${rr}</span>` : nothing}
									</div>
									<div class="card-back"><span>?</span></div>
								</div>
							</div>`;
						},
					)}
				</div>
				<div class="side-label ${windowLeft ? 'hall' : 'window'}">${windowLeft ? '廊下側' : '窓側'}</div>
			</div>
			${tv ? front : nothing}
		</div>
		${unseated.length
			? html`<div class="unseated">
					${icon('warning')}
					<span><b>席が ${unseated.length} 席足りません</b>（座れていない人：${unseated.map((n) => html`<span class="num-chip">${n}</span>`)}）</span>
				</div>`
			: nothing}`;
}

function actionsView() {
	const enabled = state.history.filter((e) => e.enabled).length;
	const canShuffle = !ui.busy && unseated.length === 0 && studentNumbers(state.config).length > 0;
	const needSave = state.kind === 'shuffled' && !state.savedId;
	return html`<div class="actions">
			<md-filled-button class="shuffle-btn" @click=${doShuffle} ?disabled=${!canShuffle}>
				${icon(ui.dopa ? 'casino' : 'shuffle', 'icon')}
				${ui.busy ? (ui.dopa ? 'ガチャ中…' : '席替え中…') : ui.dopa ? '席替えガチャを回す!!' : '席替えする'}
			</md-filled-button>
			<md-filled-tonal-button class=${classMap({ 'save-btn': true, attention: needSave })} @click=${saveCurrent} ?disabled=${ui.busy || unseated.length > 0}>
				${icon('save', 'icon')} ${state.savedId ? 'もう一度保存' : 'この席順を保存'}
			</md-filled-tonal-button>
		</div>
		<p class="avoid-note">
			${state.avoidHistory && enabled > 0
				? html`${icon('check_circle')}<span>前回までの席 <b>${enabled} 件</b>と同じ席にならないように席替えします（固定の人をのぞく）</span>`
				: html`${icon('info')}<span
							>${state.avoidHistory
								? '「前回までの席」を読み込むと、前と同じ席にならないように席替えできます'
								: '前回までの席は気にせずに席替えします'}</span
						>`}
		</p>
		${needSave
			? html`<p class="avoid-note save-hint">${icon('lightbulb')}<span>この席に決めたら「保存」しておくと、次回の席替えで被らないようにできます</span></p>`
			: nothing}`;
}

function numberField(label: string, value: number, min: number, max: number, set: (v: number) => void, unit: string) {
	return html`<md-outlined-text-field
		class="num-field"
		label=${label}
		type="number"
		inputmode="numeric"
		no-spinner
		suffix-text=${unit}
		min=${min}
		max=${max}
		.value=${live(String(value))}
		?disabled=${ui.busy}
		@change=${(e: Event) => set(Number((e.target as HTMLInputElement).value))}
	>
		<md-icon-button slot="leading-icon" @click=${() => set(value - 1)} ?disabled=${value <= min || ui.busy} aria-label="${label}を1減らす">
			${icon('remove')}
		</md-icon-button>
		<md-icon-button slot="trailing-icon" @click=${() => set(value + 1)} ?disabled=${value >= max || ui.busy} aria-label="${label}を1増やす">
			${icon('add')}
		</md-icon-button>
	</md-outlined-text-field>`;
}

const cardTitle = (ic: string, text: string, extra: unknown = nothing) => html`<h2 class="card-title">${icon(ic)}<span>${text}</span>${extra}</h2>`;

function layoutPanel() {
	const cfg = state.config;
	const offCount = cfg.disabled.length;
	return html`<section class="panel-card">
		${cardTitle('school', '教室のレイアウト')}
		<div class="field-grid">
			${numberField('縦', cfg.rows, LIMITS.rows.min, LIMITS.rows.max, (v) => setDim('rows', v), '席')}
			${numberField('横', cfg.cols, LIMITS.cols.min, LIMITS.cols.max, (v) => setDim('cols', v), '席')}
		</div>
		<div class="field-row">
			<span class="field-label">窓の位置</span>
			${segmented<'left' | 'right'>(
				[
					['left', '左側'],
					['right', '右側'],
				],
				cfg.windowSide,
				(side) => commit((s) => void (s.config.windowSide = side), { keepKind: true }),
				'窓の位置',
			)}
		</div>
		<p class="hint">${icon('info')}<span>席をクリックすると、<b>使えない席</b>にしたり<b>番号を固定</b>したりできます。</span></p>
		${offCount
			? html`<div class="sub-row">
					<span>使えない席：${offCount} 席</span>
					<md-text-button ?disabled=${ui.busy} @click=${() => commit((s) => void (s.config.disabled = []), { animate: true })}>すべて使えるようにする</md-text-button>
				</div>`
			: nothing}
	</section>`;
}

function studentsPanel() {
	const cfg = state.config;
	const count = studentNumbers(cfg).length;
	return html`<section class="panel-card">
		${cardTitle('group', '生徒')}
		<div class="field-stack">
			${numberField('人数（出席番号の最後）', cfg.studentCount, LIMITS.students.min, LIMITS.students.max, setCount, '番まで')}
			<md-outlined-text-field
				label="欠番（使わない番号）"
				placeholder="例：12, 25"
				supporting-text=${`出席番号 1〜${cfg.studentCount}${cfg.missing.length ? `（${cfg.missing.join('・')} 番をのぞく）` : ''}・${count} 人`}
				.value=${live(cfg.missing.join(', '))}
				?disabled=${ui.busy}
				@change=${(e: Event) => setMissing((e.target as HTMLInputElement).value)}
			></md-outlined-text-field>
		</div>
	</section>`;
}

function pinsPanel() {
	const pins = [...activePins(state.config)].sort((a, b) => a[1] - b[1]);
	return html`<section class="panel-card">
		${cardTitle('push_pin', '固定する人')}
		${pins.length
			? html`<md-list class="list">
					${pins.map(
						([k, n]) => html`<md-list-item>
							<span slot="start" class="num-avatar">${n}</span>
							<div slot="headline">${n}番</div>
							<div slot="supporting-text">${seatLabel(k)}</div>
							<md-icon-button slot="end" ?disabled=${ui.busy} @click=${() => unpin(k)} aria-label="${n}番の固定を解除" title="固定を解除">
								${icon('close')}
							</md-icon-button>
						</md-list-item>`,
					)}
				</md-list>`
			: html`<p class="empty">席をクリック →「番号を指定して固定」で、特定の番号の人をその席に固定できます（例：目が悪い人を前の席に）。</p>`}
	</section>`;
}

function historyPanel() {
	const h = state.history;
	return html`<section class="panel-card">
		${cardTitle('history', '前回までの席', html`<span class="count">${h.length}/10</span>`)}
		<label class="switch-row">
			<md-switch
				icons
				.selected=${live(state.avoidHistory)}
				?disabled=${ui.busy}
				@change=${(e: Event) => commit((s) => void (s.avoidHistory = (e.target as HTMLInputElement & { selected: boolean }).selected), { keepKind: true })}
			></md-switch>
			<span>前の席と<b>絶対に被らない</b>ようにする</span>
		</label>
		<div class="button-row">
			<md-filled-tonal-button ?disabled=${ui.busy} @click=${() => app.querySelector<HTMLInputElement>('#file-input')?.click()}>
				${icon('upload_file', 'icon')} ファイルを読み込む
			</md-filled-tonal-button>
			${h.length
				? html`<md-text-button @click=${() => download(`sekigae_history_${fileStamp(new Date())}.json`, serializeHistory(h))}>
						${icon('download', 'icon')} まとめて保存
					</md-text-button>`
				: nothing}
			<input
				id="file-input"
				type="file"
				accept=".json,application/json"
				multiple
				hidden
				@change=${(e: Event) => {
					const input = e.target as HTMLInputElement;
					if (input.files) void importFiles([...input.files]).finally(() => (input.value = ''));
				}}
			/>
		</div>
		${h.length === 0
			? html`<p class="empty">まだありません。席替えのあと「この席順を保存」したファイルを、次回ここで読み込みます（複数選択・ドラッグ＆ドロップ OK、最大 10 件）。</p>`
			: html`<md-list class="list">
						${repeat(
							h,
							(e) => e.id,
							(e) => html`<md-list-item class=${classMap({ off: !e.enabled, current: e.id === state.savedId })}>
								<md-checkbox
									slot="start"
									touch-target="wrapper"
									aria-label="${e.title}を被り判定に使う"
									.checked=${live(e.enabled)}
									?disabled=${ui.busy}
									@change=${(ev: Event) =>
										commit(
											(s) => {
												const t = s.history.find((x) => x.id === e.id);
												if (t) t.enabled = (ev.target as HTMLInputElement).checked;
											},
											{ keepKind: true },
										)}
								></md-checkbox>
								<div slot="headline">${e.title}</div>
								<div slot="supporting-text">${e.rows}×${e.cols}・${e.seats.length}人</div>
								<div slot="end" class="end-actions">
									<md-icon-button title="この席順を今の席として表示" aria-label="${e.title}を表示" ?disabled=${ui.busy} @click=${() => loadEntry(e)}>
										${icon('restore')}
									</md-icon-button>
									<md-icon-button
										title="一覧から外す"
										aria-label="${e.title}を一覧から外す"
										?disabled=${ui.busy}
										@click=${() => {
											commit((s) => void (s.history = s.history.filter((x) => x.id !== e.id)), { keepKind: true });
											toast(`「${e.title}」を一覧から外しました（ファイルはそのまま残っています）`);
										}}
									>
										${icon('delete')}
									</md-icon-button>
								</div>
							</md-list-item>`,
						)}
					</md-list>
					<p class="sub">チェックを外した席順は、被り判定に使いません。</p>`}
	</section>`;
}

function optionsPanel() {
	return html`<section class="panel-card">
		${cardTitle('animation', 'アニメーション')}
		${segmented<Speed>(
			[
				['normal', 'ふつう'],
				['fast', 'はやい'],
				['off', 'なし'],
			],
			state.speed,
			(v) => commit((s) => void (s.speed = v), { keepKind: true }),
			'アニメーションの速さ',
			true,
		)}
	</section>`;
}

const menuItem = (ic: string, label: string, onClick: () => void, cls = '') =>
	html`<button type="button" class="menu-item ${cls}" @click=${onClick}><md-ripple></md-ripple>${icon(ic)}<span>${label}</span></button>`;

function popoverView() {
	const p = ui.popover;
	if (!p) return nothing;
	const k = p.key;
	const cfg = state.config;
	const isOff = cfg.disabled.includes(k);
	const pin = activePins(cfg).get(k);
	const who = state.arrangement.get(k);
	return html`<div class=${classMap({ popover: true, above: p.above })} style="left:${p.x}px;top:${p.y}px" role="dialog" aria-label="${seatLabel(k)}のメニュー">
		<md-elevation></md-elevation>
		<div class="menu-header">
			<span>${seatLabel(k)}</span>
			${who !== undefined ? html`<b>${who}番</b>` : nothing}
		</div>
		${isOff
			? menuItem('check', '使える席に戻す', () => toggleDisabled(k))
			: html`
					${pin !== undefined
						? menuItem('close', `固定を解除（${pin}番）`, () => unpin(k))
						: who !== undefined
							? menuItem('push_pin', `${who}番をこの席に固定`, () => pinSeat(k, who))
							: nothing}
					<form
						class="pin-form"
						@submit=${(e: Event) => {
							e.preventDefault();
							pinFromInput(k);
						}}
					>
						<md-outlined-text-field
							label="出席番号で固定"
							placeholder="例：7"
							inputmode="numeric"
							.value=${live(ui.pinInput)}
							@input=${(e: Event) => (ui.pinInput = (e.target as HTMLInputElement).value)}
							@keydown=${(e: KeyboardEvent) => {
								if (e.key === 'Enter' && !e.isComposing) {
									e.preventDefault();
									pinFromInput(k);
								}
							}}
						></md-outlined-text-field>
						<md-filled-button type="submit">固定</md-filled-button>
					</form>
					<md-divider></md-divider>
					${menuItem('block', '使えない席にする', () => toggleDisabled(k), 'danger')}
				`}
	</div>`;
}

// ---------------- 起動 ----------------

normalize();
saveState(state);
update();
