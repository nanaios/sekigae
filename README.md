# 席替え（sekigae）

教室の席替えをブラウザだけで行うアプリです。データはブラウザの中と、自分で保存したファイルにだけ残り、サーバーには何も送りません。

同じものを 2 か所で公開しています（中身は同じビルドです）。

- Cloudflare Workers：https://sekigae.nanaryo.cc
- GitHub Pages：https://nanaios.github.io/sekigae/

ブラウザの保存領域はサイトごとに分かれるので、2 つの URL の間で設定や履歴は共有されません（席順ファイルはどちらでも読み込めます）。

## できること

- **席の数**：縦・横の席数を指定（各 1〜12 席）
- **使えない席**：席をクリック →「使えない席にする」
- **固定**：席をクリック →「出席番号で固定」で、特定の出席番号の人をその席に固定
- **前回までの席と被らない席替え**：「この席順を保存」を押すと、いまの席順を加えたこれまでの席順（最大 10 件）が **1 つの履歴ファイル**（`席替え履歴_日付.json`）にまとめて保存されます。次回はそのファイルを「前回までの席」に読み込むだけです（ドラッグ＆ドロップ可。以前の 1 件ずつのファイルも読み込めます）。チェックの入った履歴と同じ席には、固定した人を除いて**絶対に**座らせません。条件を満たす並びが存在しないときは、理由を表示して止まります
- **アニメーション**：カードが入れ替わりながら新しい席へ移動
- そのほか：欠番、全画面表示、印刷
- **その他の設定**（上部バーの歯車から開く）：表示の向き（生徒から／先生から）、窓の位置、アニメーションの速さ（ふつう／はやい／なし）、テーマ（自動／ライト／ダーク）

## 席替えのしくみ

1. 固定の人を先に置く
2. 残りの人と空いている席で「座ってよい組み合わせ」を作り、ランダム順の二部マッチングで条件を満たす並びを必ず 1 つ見つける（見つからなければ失敗を表示）
3. 条件を保ったまま入れ替えを大量に繰り返して混ぜ、偏りのない並びにする

乱数は `crypto.getRandomValues` を使っています。ロジックは `src/model.ts`、ファイル形式は `src/seatfile.ts` です。

## デザイン

Google の Material Design 3 です。部品は [Material Web](https://github.com/material-components/material-web)（`@material/web`）、配色は `@material/material-color-utilities` でシード色から作っています（`src/theme.ts`）。フォント（Roboto・Noto Sans JP）とアイコン（Material Symbols）は Google Fonts から読み込みます。

## 開発

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # ロジックのテスト（vitest）
npm run typecheck
npm run deploy     # ビルドして Cloudflare にデプロイ（要 wrangler ログイン）
```

GitHub Pages へは、`main` に push すると GitHub Actions（`.github/workflows/pages.yml`）が自動で公開します。ビルドは相対パス（`base: './'`）なので、同じファイルがどちらの URL でも動きます。
