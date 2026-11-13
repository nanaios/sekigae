// 手元の履歴ファイル（data/*.json）を使って、本番と同じ手順・同じ乱数で 1000 回席替えし、
// 「履歴に入っているどの席順とも、誰も同じ席にならない」ことを確かめる。
// data/ は Git に入れていない手元のフォルダなので、ファイルがない環境（CI など）ではこのテストは飛ばす。
// 新しい席替えの結果どうしは比べない（被ってよい）。

import { describe, expect, it } from 'vitest';
import { buildForbidden, type Config, seatKey, shuffleSeats, studentNumbers, usableSeats } from '../src/model';
import { type HistoryEntry, mergeHistory, parseSeatFile } from '../src/seatfile';

const files = import.meta.glob('../data/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const RUNS = 1000;

/** アプリでファイルを読み込んだときと同じ状態を作る（いちばん新しい席順のレイアウトを使い、固定はなし） */
function loadLikeApp(text: string) {
	const { history } = mergeHistory([], parseSeatFile(text));
	const newest = history[0];
	const cfg: Config = {
		rows: newest.rows,
		cols: newest.cols,
		disabled: [...newest.disabled],
		studentCount: newest.studentCount,
		missing: [...newest.missing],
		pins: {},
		windowSide: newest.windowSide,
	};
	const used = history.filter((e) => e.enabled);
	return { cfg, used };
}

/** その席順で、誰かが履歴のどれかと同じ席に座っていたら、その内容を返す */
function repeatsIn(arrangement: Map<string, number>, past: HistoryEntry[]): string[] {
	const out: string[] = [];
	for (const e of past) {
		for (const s of e.seats) {
			if (arrangement.get(seatKey(s.row, s.col)) === s.number) out.push(`${s.number}番が「${e.title}」と同じ席（${s.row}-${s.col}）`);
		}
	}
	return out;
}

describe.skipIf(Object.keys(files).length === 0)(`手元の履歴ファイルで ${RUNS} 回席替え`, () => {
	for (const [path, text] of Object.entries(files)) {
		const name = path.split('/').pop();

		it(`${name}：${RUNS} 回とも、履歴のどの席順とも被らない`, () => {
			const { cfg, used } = loadLikeApp(text);
			const forbidden = buildForbidden(used);
			const usable = new Set(usableSeats(cfg));
			const students = studentNumbers(cfg);

			const failures: string[] = [];
			const repeats: string[] = [];
			const distinct = new Set<string>();
			const seatsTried = new Map<number, Set<string>>(students.map((n) => [n, new Set()]));
			const started = performance.now();

			for (let i = 1; i <= RUNS; i++) {
				// 本番と同じ：乱数は crypto.getRandomValues
				const r = shuffleSeats(cfg, forbidden);
				if (!r.ok) {
					failures.push(`${i} 回目：席替えできなかった（${r.message}）`);
					continue;
				}
				const arr = r.arrangement;
				const seated = [...arr.values()].sort((a, b) => a - b);
				if (seated.join() !== students.join()) failures.push(`${i} 回目：座っている人がおかしい`);
				for (const k of arr.keys()) if (!usable.has(k)) failures.push(`${i} 回目：使えない席（${k}）に座っている`);
				for (const m of repeatsIn(arr, used)) repeats.push(`${i} 回目：${m}`);
				for (const [k, n] of arr) seatsTried.get(n)?.add(k);
				distinct.add([...arr].sort().join(';'));
			}

			const ms = Math.round(performance.now() - started);
			const spread = [...seatsTried.values()].map((s) => s.size);
			// 偏りの確認：1000 回もやれば、どの人も「座ってよい席」には全部 1 回は座るはず
			const allowedCount = (n: number) => usable.size - [...(forbidden.get(n) ?? [])].filter((k) => usable.has(k)).length;
			const fullyCovered = students.filter((n) => seatsTried.get(n)?.size === allowedCount(n));
			console.log(
				[
					`【${name}】`,
					`  比べた履歴：${used.map((e) => e.title).join(' / ')}`,
					`  ${cfg.rows}×${cfg.cols}・使える席 ${usable.size}・生徒 ${students.length} 人`,
					`  席替え ${RUNS} 回（${ms} ms）`,
					`  失敗：${failures.length} 回`,
					`  履歴と同じ席になった人：のべ ${repeats.length} 人`,
					`  違う並びになった回数：${distinct.size} / ${RUNS}`,
					`  1 人が ${RUNS} 回で座った席の種類：最少 ${Math.min(...spread)}・最多 ${Math.max(...spread)}`,
					`  座ってよい席を全部回った人：${fullyCovered.length} / ${students.length} 人`,
				].join('\n'),
			);

			expect(failures).toEqual([]);
			expect(repeats).toEqual([]);
			expect(fullyCovered).toEqual(students);
		}, 60_000);

		it(`${name}：比較用（被り判定を切ると、ちゃんと被りが見つかる）`, () => {
			const { cfg, used } = loadLikeApp(text);
			let runsWithRepeat = 0;
			for (let i = 0; i < RUNS; i++) {
				const r = shuffleSeats(cfg, new Map());
				if (r.ok && repeatsIn(r.arrangement, used).length > 0) runsWithRepeat++;
			}
			console.log(`【${name}】被り判定なしだと ${RUNS} 回中 ${runsWithRepeat} 回で、誰かが履歴と同じ席になった`);
			// 判定を切れば被りは普通に起きる＝上のテストの「0 人」はたまたまではない
			expect(runsWithRepeat).toBeGreaterThan(RUNS / 2);
		}, 60_000);
	}
});
