import { describe, expect, it } from 'vitest';
import { type Config, normalizeArrangement } from '../src/model';
import {
	type HistoryEntry,
	makeRecord,
	mergeHistory,
	parseSeatFile,
	SeatFileError,
	serializeHistory,
	serializeSeating,
} from '../src/seatfile';

const cfg: Config = {
	rows: 3,
	cols: 4,
	disabled: ['2-3'],
	studentCount: 10,
	missing: [4],
	pins: {},
	windowSide: 'right',
};

describe('席順ファイル', () => {
	it('書き出したものをそのまま読み込める', () => {
		const arr = normalizeArrangement(cfg, new Map()).arrangement;
		const rec = makeRecord(cfg, arr, new Date('2026-11-13T00:30:00Z'), 'abc');
		const [back] = parseSeatFile(serializeSeating(rec));
		expect(back).toEqual(rec);
		expect(back.seats).toHaveLength(9);
		expect(back.windowSide).toBe('right');
	});

	it('まとめて保存したファイルも読み込める', () => {
		const arr = normalizeArrangement(cfg, new Map()).arrangement;
		const a = makeRecord(cfg, arr, new Date('2026-10-01T00:00:00Z'), 'a');
		const b = makeRecord(cfg, arr, new Date('2026-11-01T00:00:00Z'), 'b');
		const recs = parseSeatFile(serializeHistory([a, b]));
		expect(recs.map((r) => r.id)).toEqual(['a', 'b']);
	});

	it('履歴ファイル 1 つで全件が戻り、チェックを外したものは外れたまま', () => {
		const arr = normalizeArrangement(cfg, new Map()).arrangement;
		const older: HistoryEntry = { ...makeRecord(cfg, arr, new Date('2026-10-01T00:00:00Z'), 'old'), enabled: false };
		const newer: HistoryEntry = { ...makeRecord(cfg, arr, new Date('2026-11-01T00:00:00Z'), 'new'), enabled: true };
		const recs = parseSeatFile(serializeHistory([newer, older]));
		expect(recs.map((r) => [r.id, r.enabled])).toEqual([
			['new', undefined],
			['old', false],
		]);
		const merged = mergeHistory([], recs);
		expect(merged.history.map((e) => [e.id, e.enabled])).toEqual([
			['new', true],
			['old', false],
		]);
		// 同じファイルをもう一度読んでも増えない
		expect(mergeHistory(merged.history, recs)).toMatchObject({ added: 0, duplicates: 2 });
	});

	it('壊れたファイルや別のファイルはわかりやすく弾く', () => {
		expect(() => parseSeatFile('not json')).toThrow(SeatFileError);
		expect(() => parseSeatFile('{"hello":1}')).toThrow('席替えアプリのファイルではありません');
		const dup = {
			format: 'sekigae/seating',
			version: 1,
			layout: { rows: 2, cols: 2 },
			seats: [
				{ row: 0, col: 0, number: 1 },
				{ row: 0, col: 1, number: 1 },
			],
		};
		expect(() => parseSeatFile(JSON.stringify(dup))).toThrow('1 番が 2 回');
		const out = { ...dup, seats: [{ row: 5, col: 0, number: 1 }] };
		expect(() => parseSeatFile(JSON.stringify(out))).toThrow('位置');
	});

	it('id が無いファイルは中身から同じ id を作る（二重読み込み防止）', () => {
		const f = { format: 'sekigae/seating', version: 1, layout: { rows: 1, cols: 2 }, seats: [{ row: 0, col: 1, number: 2 }] };
		const [a] = parseSeatFile(JSON.stringify(f));
		const [b] = parseSeatFile(JSON.stringify(f));
		expect(a.id).toBe(b.id);
		expect(a.studentCount).toBe(2);
	});
});

describe('mergeHistory', () => {
	const entry = (id: string, day: number): HistoryEntry => ({
		id,
		title: id,
		createdAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
		rows: 1,
		cols: 1,
		disabled: [],
		windowSide: 'left',
		studentCount: 1,
		missing: [],
		seats: [{ row: 0, col: 0, number: 1 }],
		enabled: true,
	});

	it('新しい順に最大 10 件、同じ id は追加しない', () => {
		const current = Array.from({ length: 9 }, (_, i) => entry(`e${i}`, i + 1));
		const res = mergeHistory(current, [entry('e3', 4), entry('new1', 20), entry('new2', 21)]);
		expect(res.added).toBe(2);
		expect(res.duplicates).toBe(1);
		expect(res.history).toHaveLength(10);
		expect(res.history[0].id).toBe('new2');
		expect(res.dropped.map((e) => e.id)).toEqual(['e0']);
	});
});
