// 画面の状態とブラウザ内（localStorage）への保存。

import { type Arrangement, clampInt, type Config, LIMITS, pruneConfig, type SeatKey, inGrid } from './model';
import { type HistoryEntry, MAX_HISTORY, parseSeatFile, serializeSeating } from './seatfile';

export type Speed = 'normal' | 'fast' | 'off';
/** order: 出席番号順 / shuffled: 席替え結果 / loaded: 履歴から読み込み / edited: 手直し */
export type ArrangementKind = 'order' | 'shuffled' | 'loaded' | 'edited';

export interface AppState {
	config: Config;
	arrangement: Arrangement;
	kind: ArrangementKind;
	/** 席替え・読み込みをした日時 */
	at: string | null;
	/** いまの並びを保存済みなら、その記録の id */
	savedId: string | null;
	avoidHistory: boolean;
	history: HistoryEntry[];
	speed: Speed;
	teacherView: boolean;
}

const KEY = 'sekigae:v1';

export function defaultState(): AppState {
	return {
		config: { rows: 6, cols: 6, disabled: [], studentCount: 35, missing: [], pins: {}, windowSide: 'left' },
		arrangement: new Map(),
		kind: 'order',
		at: null,
		savedId: null,
		avoidHistory: true,
		history: [],
		speed: 'normal',
		teacherView: false,
	};
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, def: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? clampInt(v, min, max) : def);

export function loadState(): AppState {
	const s = defaultState();
	let d: unknown;
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return s;
		d = JSON.parse(raw);
	} catch {
		return s;
	}
	if (!isObj(d)) return s;
	const c = isObj(d.config) ? d.config : {};
	const cfg: Config = {
		rows: num(c.rows, s.config.rows, LIMITS.rows.min, LIMITS.rows.max),
		cols: num(c.cols, s.config.cols, LIMITS.cols.min, LIMITS.cols.max),
		disabled: Array.isArray(c.disabled) ? c.disabled.filter((k: unknown): k is SeatKey => typeof k === 'string') : [],
		studentCount: num(c.studentCount, s.config.studentCount, LIMITS.students.min, LIMITS.students.max),
		missing: Array.isArray(c.missing) ? c.missing.filter((n: unknown): n is number => typeof n === 'number') : [],
		pins: {},
		windowSide: c.windowSide === 'right' ? 'right' : 'left',
	};
	if (isObj(c.pins)) {
		for (const [k, n] of Object.entries(c.pins)) if (typeof n === 'number' && Number.isInteger(n)) cfg.pins[k] = n;
	}
	pruneConfig(cfg);
	s.config = cfg;

	if (Array.isArray(d.arrangement)) {
		for (const pair of d.arrangement) {
			if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'number' && inGrid(cfg, pair[0])) {
				s.arrangement.set(pair[0], pair[1]);
			}
		}
	}
	if (['order', 'shuffled', 'loaded', 'edited'].includes(d.kind)) s.kind = d.kind;
	s.at = typeof d.at === 'string' ? d.at : null;
	s.savedId = typeof d.savedId === 'string' ? d.savedId : null;
	s.avoidHistory = d.avoidHistory !== false;
	if (['normal', 'fast', 'off'].includes(d.speed)) s.speed = d.speed;
	s.teacherView = d.teacherView === true;
	if (Array.isArray(d.history)) {
		s.history = d.history
			.flatMap((e: any): HistoryEntry[] => {
				try {
					const [rec] = parseSeatFile(serializeSeating(e));
					return [{ ...rec, enabled: e.enabled !== false }];
				} catch {
					return [];
				}
			})
			.slice(0, MAX_HISTORY);
	}
	return s;
}

export function saveState(s: AppState): void {
	try {
		localStorage.setItem(KEY, JSON.stringify({ ...s, arrangement: [...s.arrangement] }));
	} catch {
		// プライベートモードなどで保存できなくても動作は続ける
	}
}
