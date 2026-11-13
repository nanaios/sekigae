import { defineConfig } from 'vitest/config';

export default defineConfig({
	// 相対パスで出力して、Cloudflare（/）と GitHub Pages（/sekigae/）の両方で同じファイルをそのまま使う
	base: './',
	build: { target: 'es2022' },
	test: { include: ['test/**/*.test.ts'] },
});
