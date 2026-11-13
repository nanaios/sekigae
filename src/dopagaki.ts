// ないしょの「ドパガキモード」用の小道具。席替えの結果そのものには一切影響しない（見た目だけ）。

import { type Config, parseSeatKey, type SeatKey, usableSeats } from './model';

export type Rarity = 'N' | 'R' | 'SR' | 'SSR' | 'UR';

export const RARITY_RANK: Record<Rarity, number> = { N: 0, R: 1, SR: 2, SSR: 3, UR: 4 };
export const RARITY_POINTS: Record<Rarity, number> = { N: 100, R: 300, SR: 1000, SSR: 5000, UR: 77777 };

/**
 * 席のレア度。後ろほど・窓側ほど高く、いちばん後ろの窓側が UR（主人公席）。
 * 席替えの抽選には関係なく、演出の順番と表示にだけ使う。
 */
export function seatRarities(cfg: Config): Map<SeatKey, Rarity> {
	const scored = usableSeats(cfg).map((k) => {
		const { row, col } = parseSeatKey(k);
		const depth = cfg.rows > 1 ? row / (cfg.rows - 1) : 1;
		const toWindow = cfg.cols > 1 ? (cfg.windowSide === 'left' ? 1 - col / (cfg.cols - 1) : col / (cfg.cols - 1)) : 1;
		return { k, score: depth * 2 + toWindow * 0.9 + depth * toWindow };
	});
	scored.sort((a, b) => b.score - a.score || a.k.localeCompare(b.k));
	const n = scored.length;
	const ssr = Math.max(1, Math.round(n * 0.1));
	const sr = Math.round(n * 0.2);
	const r = Math.round(n * 0.3);
	const out = new Map<SeatKey, Rarity>();
	scored.forEach((s, i) =>
		out.set(s.k, i === 0 ? 'UR' : i <= ssr ? 'SSR' : i <= ssr + sr ? 'SR' : i <= ssr + sr + r ? 'R' : 'N'),
	);
	return out;
}

/** need 回、間隔 gapMs 以内で連打されたら onFire を呼ぶ */
export function createSecretCounter(onFire: () => void, need = 10, gapMs = 700): () => void {
	let count = 0;
	let last = 0;
	return () => {
		const now = performance.now();
		count = now - last <= gapMs ? count + 1 : 1;
		last = now;
		if (count >= need) {
			count = 0;
			onFire();
		}
	};
}

export const HYPE = ['激アツ!!', '超激アツ!!!', '確定演出!?', '虹色の予感…!!', 'ｷﾀ━(ﾟ∀ﾟ)━!!', '神引きの予感!!'];

export const tickerText = (seats: number) =>
	`🔥 席替えガチャ開催中!! 🔥 主人公席（UR）排出率 1/${seats}!! 💎 SSR 神席 続々排出中!! 🎉 全員もれなく席確定!! 🚀 ドーパミン放出量 当社比1000%!! 🌈 `;

export const DOPA_EMOJI = ['🔥', '💎', '✨', '🎉', '🌈', '⚡', '🎰', '💥', '🚀', '⭐', '🍭', '👑', '💯', '🎊', '🤑', '🥳'];
