// 席・生徒・固定・制約付きシャッフルなど、画面に依存しない純粋なロジック。

/** 席の位置を表すキー。"行-列"（行は前から 0 始まり、列は生徒から見て左から 0 始まり） */
export type SeatKey = string;

export type WindowSide = 'left' | 'right';

export const LIMITS = {
	rows: { min: 1, max: 12 },
	cols: { min: 1, max: 12 },
	students: { min: 1, max: 144 },
} as const;

export interface Config {
	rows: number;
	cols: number;
	/** 使えない席 */
	disabled: SeatKey[];
	/** 出席番号は 1〜studentCount（欠番を除く） */
	studentCount: number;
	/** 欠番（転出などで使わない番号） */
	missing: number[];
	/** 席 → 固定する出席番号 */
	pins: Record<SeatKey, number>;
	/** 窓がどちら側か（生徒から見て） */
	windowSide: WindowSide;
}

/** 席 → 出席番号 */
export type Arrangement = Map<SeatKey, number>;

export type Rng = () => number;

export const seatKey = (row: number, col: number): SeatKey => `${row}-${col}`;

export function parseSeatKey(key: SeatKey): { row: number; col: number } {
	const [row, col] = key.split('-').map(Number);
	return { row, col };
}

export function inGrid(cfg: Pick<Config, 'rows' | 'cols'>, key: SeatKey): boolean {
	const { row, col } = parseSeatKey(key);
	return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < cfg.rows && col < cfg.cols;
}

export const clampInt = (v: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : min)));

/** 使える席。出席番号順に並べるときの順番（左の列から、前→後ろ）で返す */
export function usableSeats(cfg: Config): SeatKey[] {
	const off = new Set(cfg.disabled);
	const out: SeatKey[] = [];
	for (let c = 0; c < cfg.cols; c++) {
		for (let r = 0; r < cfg.rows; r++) {
			const k = seatKey(r, c);
			if (!off.has(k)) out.push(k);
		}
	}
	return out;
}

/** 在籍している出席番号（欠番を除く） */
export function studentNumbers(cfg: Config): number[] {
	const miss = new Set(cfg.missing);
	const out: number[] = [];
	for (let n = 1; n <= cfg.studentCount; n++) if (!miss.has(n)) out.push(n);
	return out;
}

/** 実際に効いている固定（席が使える・番号が在籍・番号の重複なし） */
export function activePins(cfg: Config): Map<SeatKey, number> {
	const usable = new Set(usableSeats(cfg));
	const enrolled = new Set(studentNumbers(cfg));
	const used = new Set<number>();
	const out = new Map<SeatKey, number>();
	for (const [k, n] of Object.entries(cfg.pins)) {
		if (usable.has(k) && enrolled.has(n) && !used.has(n)) {
			out.set(k, n);
			used.add(n);
		}
	}
	return out;
}

/** 範囲外になった使えない席・固定・欠番を取り除く */
export function pruneConfig(cfg: Config): void {
	cfg.disabled = [...new Set(cfg.disabled)].filter((k) => inGrid(cfg, k));
	cfg.missing = [...new Set(cfg.missing)].filter((n) => Number.isInteger(n) && n >= 1 && n <= cfg.studentCount).sort((a, b) => a - b);
	const off = new Set(cfg.disabled);
	const miss = new Set(cfg.missing);
	for (const [k, n] of Object.entries(cfg.pins)) {
		if (!inGrid(cfg, k) || off.has(k) || n < 1 || n > cfg.studentCount || miss.has(n)) delete cfg.pins[k];
	}
}

/**
 * 今の設定に合うように並びを整える。
 * 固定を最優先し、元の並びで座れる人はそのまま、あぶれた人は空いている席に番号順で入れる。
 */
export function normalizeArrangement(cfg: Config, prev: Arrangement): { arrangement: Arrangement; unseated: number[] } {
	const seats = usableSeats(cfg);
	const seatSet = new Set(seats);
	const enrolled = studentNumbers(cfg);
	const enrolledSet = new Set(enrolled);
	const next: Arrangement = new Map();
	const placed = new Set<number>();
	for (const [k, n] of activePins(cfg)) {
		next.set(k, n);
		placed.add(n);
	}
	for (const [k, n] of prev) {
		if (seatSet.has(k) && !next.has(k) && enrolledSet.has(n) && !placed.has(n)) {
			next.set(k, n);
			placed.add(n);
		}
	}
	const unseated: number[] = [];
	let i = 0;
	for (const n of enrolled) {
		if (placed.has(n)) continue;
		while (i < seats.length && next.has(seats[i])) i++;
		if (i < seats.length) {
			next.set(seats[i], n);
			placed.add(n);
		} else {
			unseated.push(n);
		}
	}
	return { arrangement: next, unseated };
}

/** 暗号学的乱数（0 以上 1 未満） */
export const cryptoRng: Rng = () => {
	const a = new Uint32Array(1);
	crypto.getRandomValues(a);
	return a[0] / 2 ** 32;
};

/** 再現できる乱数（テスト用） */
export function seededRng(seed: number): Rng {
	let t = seed >>> 0;
	return () => {
		t = (t + 0x6d2b79f5) >>> 0;
		let x = t;
		x = Math.imul(x ^ (x >>> 15), x | 1);
		x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
		return ((x ^ (x >>> 14)) >>> 0) / 2 ** 32;
	};
}

export function shuffleInPlace<T>(arr: T[], rng: Rng): T[] {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

/** 過去の席順から「その人が座ってはいけない席」を作る */
export function buildForbidden(records: { seats: { row: number; col: number; number: number }[] }[]): Map<number, Set<SeatKey>> {
	const map = new Map<number, Set<SeatKey>>();
	for (const rec of records) {
		for (const s of rec.seats) {
			let set = map.get(s.number);
			if (!set) map.set(s.number, (set = new Set()));
			set.add(seatKey(s.row, s.col));
		}
	}
	return map;
}

export type ShuffleResult = { ok: true; arrangement: Arrangement } | { ok: false; message: string };

/**
 * 固定の人をその席に置いたうえで、残りの人を「座ってはいけない席」を避けてランダムに並べる。
 * 1) ランダム順の二部マッチング（Kuhn 法）で条件を満たす並びを必ず見つける（なければ失敗を返す）
 * 2) 条件を保ったまま入れ替えを大量に繰り返し（マルコフ連鎖）、偏りのない並びに混ぜる
 */
export function shuffleSeats(cfg: Config, forbidden: Map<number, Set<SeatKey>>, rng: Rng = cryptoRng): ShuffleResult {
	const pins = activePins(cfg);
	const pinnedNums = new Set(pins.values());
	const freeSeats = usableSeats(cfg).filter((k) => !pins.has(k));
	const freeStudents = studentNumbers(cfg).filter((n) => !pinnedNums.has(n));

	if (freeStudents.length > freeSeats.length) {
		return { ok: false, message: `席が ${freeStudents.length - freeSeats.length} 席足りません。席を増やすか、人数を見直してください。` };
	}

	const allowedFor = (p: number, s: number) => !forbidden.get(freeStudents[p])?.has(freeSeats[s]);
	const allowed: number[][] = freeStudents.map((_, p) => freeSeats.map((_, s) => s).filter((s) => allowedFor(p, s)));

	const stuck = freeStudents.filter((_, p) => allowed[p].length === 0);
	if (stuck.length > 0) {
		return {
			ok: false,
			message: `${stuck.join('・')} 番が座れる席がありません（空いている席がすべて前の席と同じです）。読み込む履歴を減らすか、固定を見直してください。`,
		};
	}

	// 1) ランダム化した Kuhn 法で完全マッチングを探す
	const seatOwner = new Int32Array(freeSeats.length).fill(-1);
	const order = shuffleInPlace(freeStudents.map((_, p) => p), rng);
	for (const p of order) shuffleInPlace(allowed[p], rng);
	const tryAssign = (p: number, seen: Uint8Array): boolean => {
		for (const s of allowed[p]) {
			if (seen[s]) continue;
			seen[s] = 1;
			if (seatOwner[s] === -1 || tryAssign(seatOwner[s], seen)) {
				seatOwner[s] = p;
				return true;
			}
		}
		return false;
	};
	for (const p of order) {
		if (!tryAssign(p, new Uint8Array(freeSeats.length))) {
			return {
				ok: false,
				message: '条件が厳しすぎて、前の席と被らない並べ方が見つかりませんでした。読み込む履歴を減らすか、固定を減らしてください。',
			};
		}
	}

	// 2) 条件を保ったまま混ぜる（提案が対称なので、到達できる並びの中で一様になる）
	const seatOf = new Int32Array(freeStudents.length);
	seatOwner.forEach((p, s) => {
		if (p >= 0) seatOf[p] = s;
	});
	const steps = freeStudents.length === 0 ? 0 : 200 * (freeStudents.length + freeSeats.length);
	for (let t = 0; t < steps; t++) {
		const a = Math.floor(rng() * freeStudents.length);
		const target = Math.floor(rng() * freeSeats.length);
		const from = seatOf[a];
		if (target === from || !allowedFor(a, target)) continue;
		const b = seatOwner[target];
		if (b === -1) {
			seatOwner[from] = -1;
		} else {
			if (!allowedFor(b, from)) continue;
			seatOwner[from] = b;
			seatOf[b] = from;
		}
		seatOwner[target] = a;
		seatOf[a] = target;
	}

	const arrangement: Arrangement = new Map(pins);
	freeStudents.forEach((n, p) => arrangement.set(freeSeats[seatOf[p]], n));

	// 念のため最終確認
	for (const [k, n] of arrangement) {
		if (!pinnedNums.has(n) && forbidden.get(n)?.has(k)) {
			return { ok: false, message: '内部エラー：前の席と被る並びができてしまいました。もう一度お試しください。' };
		}
	}
	return { ok: true, arrangement };
}

/** アニメーション用の途中経過（固定の人は動かさない・条件は無視） */
export function scrambleArrangement(cfg: Config, current: Arrangement, rng: Rng = Math.random): Arrangement {
	const pins = activePins(cfg);
	const free = shuffleInPlace(usableSeats(cfg).filter((k) => !pins.has(k)), rng);
	const movers = [...current].filter(([k]) => !pins.has(k)).map(([, n]) => n);
	const out: Arrangement = new Map(pins);
	movers.forEach((n, i) => {
		if (i < free.length) out.set(free[i], n);
	});
	return out;
}

/** 「左から 2 列目・前から 3 番目」のような席の呼び方 */
export function seatLabel(key: SeatKey): string {
	const { row, col } = parseSeatKey(key);
	return `左から${col + 1}列目・前から${row + 1}番目`;
}
