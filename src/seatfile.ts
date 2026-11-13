// 席順ファイル（JSON）の書き出し・読み込み。サーバーには何も送らない。

import { type Arrangement, type Config, LIMITS, parseSeatKey, type SeatKey, seatKey, type WindowSide, inGrid } from './model';

export const SEATING_FORMAT = 'sekigae/seating';
export const HISTORY_FORMAT = 'sekigae/history';
export const MAX_HISTORY = 10;

export interface SeatRecordSeat {
	row: number;
	col: number;
	number: number;
}

export interface SeatingRecord {
	id: string;
	title: string;
	createdAt: string;
	rows: number;
	cols: number;
	disabled: SeatKey[];
	windowSide: WindowSide;
	studentCount: number;
	missing: number[];
	seats: SeatRecordSeat[];
}

export interface HistoryEntry extends SeatingRecord {
	/** 「前の席と被らない」判定に使うか */
	enabled: boolean;
}

export class SeatFileError extends Error {}

const fail = (message: string): never => {
	throw new SeatFileError(message);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(d: Date): string {
	return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export function formatDateTime(d: Date): string {
	return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ファイル名用 2026-11-13_0930 */
export function fileStamp(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function newId(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 中身から決まる ID（id が無い手作りファイル用） */
function contentId(rows: number, cols: number, seats: SeatRecordSeat[]): string {
	const text = `${rows}x${cols}:` + seats.map((s) => `${s.row},${s.col},${s.number}`).join(';');
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return `h-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

const sortSeats = (seats: SeatRecordSeat[]) => seats.sort((a, b) => a.row - b.row || a.col - b.col);

export function makeRecord(cfg: Config, arrangement: Arrangement, now = new Date(), id = newId()): SeatingRecord {
	const seats = sortSeats([...arrangement].map(([k, n]) => ({ ...parseSeatKey(k), number: n })));
	return {
		id,
		title: `${formatDateTime(now)} の席替え`,
		createdAt: now.toISOString(),
		rows: cfg.rows,
		cols: cfg.cols,
		disabled: cfg.disabled.filter((k) => inGrid(cfg, k)).sort(),
		windowSide: cfg.windowSide,
		studentCount: cfg.studentCount,
		missing: [...cfg.missing].sort((a, b) => a - b),
		seats,
	};
}

function toJson(rec: SeatingRecord) {
	return {
		format: SEATING_FORMAT,
		version: 1,
		id: rec.id,
		title: rec.title,
		createdAt: rec.createdAt,
		layout: {
			rows: rec.rows,
			cols: rec.cols,
			windowSide: rec.windowSide,
			disabled: rec.disabled.map(parseSeatKey),
		},
		students: { count: rec.studentCount, missing: rec.missing },
		seats: rec.seats.map(({ row, col, number }) => ({ row, col, number })),
	};
}

export function serializeSeating(rec: SeatingRecord): string {
	return JSON.stringify(toJson(rec), null, 2) + '\n';
}

export function serializeHistory(records: SeatingRecord[], now = new Date()): string {
	return JSON.stringify({ format: HISTORY_FORMAT, version: 1, exportedAt: now.toISOString(), seatings: records.map(toJson) }, null, 2) + '\n';
}

/** 1 つの席順ファイル、または「まとめて保存」したファイルを読む */
export function parseSeatFile(text: string): SeatingRecord[] {
	let data: unknown;
	try {
		data = JSON.parse(text.replace(/^﻿/, ''));
	} catch {
		return fail('JSON として読み込めませんでした');
	}
	if (!isObj(data)) return fail('席替えアプリのファイルではありません');
	if (data.format === HISTORY_FORMAT) {
		if (!Array.isArray(data.seatings)) return fail('席順の一覧がありません');
		return data.seatings.map((s, i) => {
			try {
				return parseSeating(s);
			} catch (e) {
				return fail(`${i + 1} 件目：${(e as Error).message}`);
			}
		});
	}
	if (data.format === SEATING_FORMAT) return [parseSeating(data)];
	return fail('席替えアプリのファイルではありません');
}

function parseSeating(d: unknown): SeatingRecord {
	if (!isObj(d)) return fail('形式が正しくありません');
	if (d.version !== 1) return fail(`対応していないバージョンです（${String(d.version)}）`);
	const layout = isObj(d.layout) ? d.layout : fail('レイアウト情報がありません');
	const { rows, cols } = layout;
	if (!isInt(rows, LIMITS.rows.min, LIMITS.rows.max) || !isInt(cols, LIMITS.cols.min, LIMITS.cols.max)) {
		return fail('縦・横の席数が正しくありません');
	}
	const pos = (p: unknown, what: string): SeatRecordSeat & { number?: number } => {
		if (!isObj(p) || !isInt(p.row, 0, rows - 1) || !isInt(p.col, 0, cols - 1)) return fail(`${what}の位置が正しくありません`);
		return { row: p.row, col: p.col, number: 0 };
	};
	const disabled = Array.isArray(layout.disabled) ? [...new Set(layout.disabled.map((p) => {
		const { row, col } = pos(p, '使えない席');
		return seatKey(row, col);
	}))].sort() : [];

	if (!Array.isArray(d.seats)) return fail('席の情報がありません');
	const seenSeat = new Set<string>();
	const seenNum = new Set<number>();
	const seats = sortSeats(
		d.seats.map((s) => {
			const { row, col } = pos(s, '席');
			const number = (s as Record<string, unknown>).number;
			if (!isInt(number, 1, LIMITS.students.max)) return fail('出席番号が正しくありません');
			const k = seatKey(row, col);
			if (seenSeat.has(k)) return fail('同じ席に 2 人が座っています');
			if (seenNum.has(number)) return fail(`${number} 番が 2 回出てきます`);
			seenSeat.add(k);
			seenNum.add(number);
			return { row, col, number };
		}),
	);

	const st = isObj(d.students) ? d.students : {};
	const maxNum = seats.reduce((m, s) => Math.max(m, s.number), 0);
	const studentCount = isInt(st.count, 1, LIMITS.students.max) ? Math.max(st.count, maxNum) : Math.max(1, maxNum);
	const missing = Array.isArray(st.missing)
		? [...new Set(st.missing.filter((n): n is number => isInt(n, 1, studentCount) && !seenNum.has(n)))].sort((a, b) => a - b)
		: [];

	const created = typeof d.createdAt === 'string' ? new Date(d.createdAt) : new Date(NaN);
	const createdAt = Number.isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString();
	const title =
		typeof d.title === 'string' && d.title.trim() ? d.title.trim().slice(0, 60) : `${formatDateTime(new Date(createdAt))} の席替え`;
	const id = typeof d.id === 'string' && d.id.trim() ? d.id.trim().slice(0, 64) : contentId(rows, cols, seats);

	return {
		id,
		title,
		createdAt,
		rows,
		cols,
		disabled,
		windowSide: layout.windowSide === 'right' ? 'right' : 'left',
		studentCount,
		missing,
		seats,
	};
}

/** 履歴に追加する。ID が同じものは追加しない。新しい順に最大 10 件 */
export function mergeHistory(current: HistoryEntry[], incoming: SeatingRecord[]) {
	const byId = new Map(current.map((e) => [e.id, e] as const));
	let added = 0;
	let duplicates = 0;
	for (const rec of incoming) {
		if (byId.has(rec.id)) {
			duplicates++;
			continue;
		}
		byId.set(rec.id, { ...rec, enabled: true });
		added++;
	}
	const all = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	return { history: all.slice(0, MAX_HISTORY), added, duplicates, dropped: all.slice(MAX_HISTORY) };
}
