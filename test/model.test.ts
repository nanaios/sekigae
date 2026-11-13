import { describe, expect, it } from 'vitest';
import {
	activePins,
	buildForbidden,
	type Config,
	normalizeArrangement,
	parseSeatKey,
	pruneConfig,
	scrambleArrangement,
	seatKey,
	seededRng,
	shuffleSeats,
	studentNumbers,
	usableSeats,
} from '../src/model';

const base = (over: Partial<Config> = {}): Config => ({
	rows: 6,
	cols: 6,
	disabled: [],
	studentCount: 35,
	missing: [],
	pins: {},
	windowSide: 'left',
	...over,
});

const toRecord = (arr: Map<string, number>) => ({
	seats: [...arr].map(([k, n]) => ({ ...parseSeatKey(k), number: n })),
});

describe('usableSeats / studentNumbers', () => {
	it('使えない席を除き、左の列から前→後ろの順に並ぶ', () => {
		const cfg = base({ rows: 2, cols: 2, disabled: ['1-0'] });
		expect(usableSeats(cfg)).toEqual(['0-0', '0-1', '1-1']);
	});
	it('欠番を除く', () => {
		expect(studentNumbers(base({ studentCount: 5, missing: [2, 4] }))).toEqual([1, 3, 5]);
	});
});

describe('activePins / pruneConfig', () => {
	it('使えない席・範囲外・重複の固定は効かない', () => {
		const cfg = base({ disabled: ['0-0'], pins: { '0-0': 1, '0-1': 2, '0-2': 2, '9-9': 3, '1-1': 99 } });
		expect([...activePins(cfg)]).toEqual([['0-1', 2]]);
	});
	it('範囲外になったものを取り除く', () => {
		const cfg = base({ rows: 2, cols: 2, disabled: ['0-0', '5-5'], pins: { '1-1': 3, '3-3': 4, '0-0': 5 }, studentCount: 4, missing: [2, 9] });
		pruneConfig(cfg);
		expect(cfg.disabled).toEqual(['0-0']);
		expect(cfg.pins).toEqual({ '1-1': 3 });
		expect(cfg.missing).toEqual([2]);
	});
});

describe('normalizeArrangement', () => {
	it('最初は出席番号順に座らせる', () => {
		const cfg = base({ rows: 2, cols: 2, studentCount: 3 });
		const { arrangement, unseated } = normalizeArrangement(cfg, new Map());
		expect([...arrangement]).toEqual([
			['0-0', 1],
			['1-0', 2],
			['0-1', 3],
		]);
		expect(unseated).toEqual([]);
	});
	it('固定を優先し、あぶれた人は空席へ', () => {
		const cfg = base({ rows: 2, cols: 2, studentCount: 3, pins: { '0-0': 3 } });
		const prev = new Map([
			['0-0', 1],
			['1-0', 2],
			['0-1', 3],
		]);
		const { arrangement } = normalizeArrangement(cfg, prev);
		expect(arrangement.get('0-0')).toBe(3);
		expect(arrangement.get('1-0')).toBe(2);
		expect(arrangement.get('0-1')).toBe(1);
	});
	it('席が足りないときは座れない人を返す', () => {
		const cfg = base({ rows: 1, cols: 2, studentCount: 3 });
		expect(normalizeArrangement(cfg, new Map()).unseated).toEqual([3]);
	});
});

describe('shuffleSeats', () => {
	const check = (cfg: Config, arr: Map<string, number>) => {
		const nums = [...arr.values()].sort((a, b) => a - b);
		expect(nums).toEqual(studentNumbers(cfg));
		const usable = new Set(usableSeats(cfg));
		for (const k of arr.keys()) expect(usable.has(k)).toBe(true);
		for (const [k, n] of activePins(cfg)) expect(arr.get(k)).toBe(n);
	};

	it('全員が使える席に 1 人ずつ座り、固定は守られる', () => {
		// 34 席に 32 人（空席あり）
		const cfg = base({ disabled: ['5-0', '5-5'], studentCount: 32, pins: { '0-2': 7, '3-3': 20 } });
		for (let seed = 1; seed <= 30; seed++) {
			const r = shuffleSeats(cfg, new Map(), seededRng(seed));
			expect(r.ok).toBe(true);
			if (r.ok) check(cfg, r.arrangement);
		}
	});

	it('履歴 10 件ぶんの席を絶対に避ける', () => {
		const cfg = base({ studentCount: 36, pins: { '0-0': 1 } });
		const rng = seededRng(42);
		const history: Map<string, number>[] = [];
		let current = normalizeArrangement(cfg, new Map()).arrangement;
		history.push(current);
		for (let i = 0; i < 10; i++) {
			const forbidden = buildForbidden(history.slice(-10).map(toRecord));
			const r = shuffleSeats(cfg, forbidden, rng);
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			check(cfg, r.arrangement);
			for (const [k, n] of r.arrangement) {
				if (n === 1) continue; // 固定の人は対象外
				expect(forbidden.get(n)?.has(k) ?? false).toBe(false);
			}
			current = r.arrangement;
			history.push(current);
		}
	});

	it('席が足りないと失敗する', () => {
		const r = shuffleSeats(base({ rows: 2, cols: 2, studentCount: 5 }), new Map());
		expect(r.ok).toBe(false);
	});

	it('座れる席が 1 つもない人がいると、その番号を教えてくれる', () => {
		const cfg = base({ rows: 1, cols: 2, studentCount: 2 });
		const forbidden = buildForbidden([
			{ seats: [{ row: 0, col: 0, number: 2 }] },
			{ seats: [{ row: 0, col: 1, number: 2 }] },
		]);
		const r = shuffleSeats(cfg, forbidden);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain('2 番');
	});

	it('どう並べても条件を満たせないときは失敗する（ホールの条件違反）', () => {
		// 3 人とも 0-0 と 0-1 が NG で、空いているのは 0-0, 0-1, 0-2 だけ
		const cfg = base({ rows: 1, cols: 3, studentCount: 3 });
		const forbidden = new Map<number, Set<string>>([
			[1, new Set(['0-0', '0-1'])],
			[2, new Set(['0-0', '0-1'])],
			[3, new Set(['0-0'])],
		]);
		expect(shuffleSeats(cfg, forbidden).ok).toBe(false);
	});

	it('偏りなく混ざる（どの人もいろいろな席に座る）', () => {
		const cfg = base({ rows: 2, cols: 3, studentCount: 6 });
		const counts = new Map<string, number>();
		const rng = seededRng(7);
		const N = 3000;
		for (let i = 0; i < N; i++) {
			const r = shuffleSeats(cfg, new Map(), rng);
			if (!r.ok) throw new Error(r.message);
			for (const [k, n] of r.arrangement) if (n === 1) counts.set(k, (counts.get(k) ?? 0) + 1);
		}
		expect(counts.size).toBe(6);
		for (const c of counts.values()) expect(Math.abs(c / N - 1 / 6)).toBeLessThan(0.03);
	});
});

describe('scrambleArrangement', () => {
	it('固定の人は動かさず、人数は変わらない', () => {
		const cfg = base({ pins: { [seatKey(2, 2)]: 5 } });
		const start = normalizeArrangement(cfg, new Map()).arrangement;
		const mid = scrambleArrangement(cfg, start, seededRng(3));
		expect(mid.get('2-2')).toBe(5);
		expect([...mid.values()].sort((a, b) => a - b)).toEqual([...start.values()].sort((a, b) => a - b));
	});
});
