// 演出まわり（効果音・紙吹雪・画面揺れ・文字演出）。外部ファイルは使わず全部その場で作る。

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------- 効果音（Web Audio で合成） ----------------

export const sound = { muted: false };
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function audio(): AudioContext | null {
	if (sound.muted) return null;
	try {
		if (!ctx) {
			ctx = new AudioContext();
			master = ctx.createGain();
			master.gain.value = 0.2;
			master.connect(ctx.destination);
		}
		if (ctx.state === 'suspended') void ctx.resume();
		return ctx;
	} catch {
		return null;
	}
}

interface ToneOpts {
	type?: OscillatorType;
	vol?: number;
	at?: number;
	slide?: number;
}

function tone(freq: number, dur: number, { type = 'square', vol = 0.4, at = 0, slide }: ToneOpts = {}) {
	const ac = audio();
	if (!ac || !master) return;
	const t = ac.currentTime + at;
	const o = ac.createOscillator();
	const g = ac.createGain();
	o.type = type;
	o.frequency.setValueAtTime(freq, t);
	if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
	g.gain.setValueAtTime(0.0001, t);
	g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
	g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	o.connect(g).connect(master);
	o.start(t);
	o.stop(t + dur + 0.05);
}

interface NoiseOpts {
	vol?: number;
	at?: number;
	freq?: number;
	q?: number;
	sweepTo?: number;
}

function noise(dur: number, { vol = 0.3, at = 0, freq = 1200, q = 0.8, sweepTo }: NoiseOpts = {}) {
	const ac = audio();
	if (!ac || !master) return;
	if (!noiseBuf) {
		noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
		const ch = noiseBuf.getChannelData(0);
		for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
	}
	const t = ac.currentTime + at;
	const src = ac.createBufferSource();
	src.buffer = noiseBuf;
	src.loop = true;
	const f = ac.createBiquadFilter();
	f.type = 'bandpass';
	f.frequency.setValueAtTime(freq, t);
	if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
	f.Q.value = q;
	const g = ac.createGain();
	g.gain.setValueAtTime(vol, t);
	g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	src.connect(f).connect(g).connect(master);
	src.start(t);
	src.stop(t + dur + 0.05);
}

export const sfx = {
	on() {
		[523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.16, { at: i * 0.055, vol: 0.32 }));
		noise(0.7, { freq: 300, sweepTo: 7000, vol: 0.28 });
		tone(2093, 0.7, { at: 0.4, type: 'triangle', vol: 0.3 });
	},
	off() {
		[784, 659, 523, 392].forEach((f, i) => tone(f, 0.14, { at: i * 0.07, type: 'triangle', vol: 0.35 }));
	},
	start() {
		noise(0.5, { freq: 250, sweepTo: 5000, vol: 0.3 });
		tone(110, 0.55, { type: 'sawtooth', slide: 880, vol: 0.25 });
	},
	drumroll(sec: number) {
		for (let t = 0; t < sec; t += 0.05) noise(0.045, { at: t, freq: 160 + t * 70, q: 1.4, vol: 0.18 + (t / sec) * 0.35 });
	},
	whoosh() {
		noise(0.28, { freq: 500, sweepTo: 3500, vol: 0.18 });
	},
	hype() {
		[392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, { at: i * 0.045, type: 'sawtooth', vol: 0.28 }));
		tone(1568, 0.7, { at: 0.24, vol: 0.22 });
	},
	tick(i: number) {
		tone(480 + Math.min(i, 45) * 24, 0.07, { vol: 0.26 });
	},
	rare() {
		[880, 1109, 1319, 1760, 2217].forEach((f, i) => tone(f, 0.28, { at: i * 0.04, type: 'triangle', vol: 0.36 }));
	},
	ur() {
		noise(1.2, { freq: 200, sweepTo: 9000, vol: 0.35 });
		[262, 330, 392, 523].forEach((f) => tone(f, 1.6, { at: 0.25, type: 'sawtooth', vol: 0.16 }));
		[1047, 1319, 1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 0.3, { at: 0.25 + i * 0.07, type: 'triangle', vol: 0.3 }));
	},
	fanfare() {
		const seq: [number, number, number][] = [
			[523, 0, 0.1],
			[523, 0.12, 0.1],
			[523, 0.24, 0.1],
			[659, 0.36, 0.22],
			[784, 0.6, 0.16],
			[659, 0.78, 0.1],
			[784, 0.9, 0.12],
			[1047, 1.05, 0.7],
		];
		for (const [f, at, d] of seq) tone(f, d, { at, vol: 0.3 });
		tone(262, 1.2, { at: 1.05, type: 'sawtooth', vol: 0.16 });
	},
};

// ---------------- 紙吹雪 ----------------

export const RAINBOW = ['#ff3b6b', '#ff9f1c', '#ffe14d', '#3dff8b', '#3dd6ff', '#7b61ff', '#ff5cf0'];
export const GOLD = ['#ffd700', '#ffec8b', '#ffb300', '#fff3c4', '#ffa000'];

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	w: number;
	h: number;
	color: string;
	rot: number;
	vr: number;
	life: number;
	max: number;
	shape: number;
}

let canvas: HTMLCanvasElement | null = null;
let c2d: CanvasRenderingContext2D | null = null;
let parts: Particle[] = [];
let raf = 0;

function resizeCanvas() {
	if (!canvas || !c2d) return;
	const dpr = Math.min(2, devicePixelRatio || 1);
	canvas.width = innerWidth * dpr;
	canvas.height = innerHeight * dpr;
	c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function ensureCanvas() {
	if (canvas) return;
	canvas = document.createElement('canvas');
	canvas.className = 'fx-canvas';
	canvas.setAttribute('aria-hidden', 'true');
	document.body.append(canvas);
	c2d = canvas.getContext('2d');
	resizeCanvas();
	addEventListener('resize', resizeCanvas);
}

interface ConfettiOpts {
	x?: number;
	y?: number;
	count?: number;
	power?: number;
	angle?: number;
	spread?: number;
	colors?: string[];
}

export function confetti({
	x = innerWidth / 2,
	y = innerHeight / 2,
	count = 80,
	power = 10,
	angle = -Math.PI / 2,
	spread = Math.PI * 2,
	colors = RAINBOW,
}: ConfettiOpts = {}) {
	ensureCanvas();
	for (let i = 0; i < count; i++) {
		const a = angle + (Math.random() - 0.5) * spread;
		const sp = power * (0.35 + Math.random() * 0.85);
		parts.push({
			x,
			y,
			vx: Math.cos(a) * sp,
			vy: Math.sin(a) * sp,
			w: 6 + Math.random() * 7,
			h: 4 + Math.random() * 9,
			color: colors[i % colors.length],
			rot: Math.random() * Math.PI * 2,
			vr: (Math.random() - 0.5) * 0.4,
			life: 0,
			max: 80 + Math.random() * 70,
			shape: Math.floor(Math.random() * 3),
		});
	}
	if (parts.length > 1200) parts.splice(0, parts.length - 1200);
	if (!raf) raf = requestAnimationFrame(step);
}

function star(g: CanvasRenderingContext2D, r: number) {
	g.beginPath();
	for (let i = 0; i < 10; i++) {
		const rr = i % 2 ? r * 0.45 : r;
		const a = (i * Math.PI) / 5 - Math.PI / 2;
		g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
	}
	g.closePath();
	g.fill();
}

function step() {
	const g = c2d;
	if (!g) return;
	g.clearRect(0, 0, innerWidth, innerHeight);
	for (const p of parts) {
		p.life++;
		p.vy += 0.24;
		p.vx *= 0.985;
		p.vy *= 0.985;
		p.x += p.vx;
		p.y += p.vy;
		p.rot += p.vr;
		g.globalAlpha = Math.max(0, 1 - p.life / p.max);
		g.fillStyle = p.color;
		g.save();
		g.translate(p.x, p.y);
		g.rotate(p.rot);
		if (p.shape === 0) g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
		else if (p.shape === 1) {
			g.beginPath();
			g.arc(0, 0, p.w / 2, 0, Math.PI * 2);
			g.fill();
		} else star(g, p.w * 0.75);
		g.restore();
	}
	g.globalAlpha = 1;
	parts = parts.filter((p) => p.life < p.max && p.y < innerHeight + 60);
	raf = parts.length ? requestAnimationFrame(step) : 0;
	if (!raf) g.clearRect(0, 0, innerWidth, innerHeight);
}

// ---------------- 画面演出 ----------------

export function shake(el: Element, power = 10, duration = 500) {
	const frames: Keyframe[] = Array.from({ length: 12 }, (_, i) =>
		i === 11
			? { transform: 'none' }
			: { transform: `translate(${(Math.random() - 0.5) * power * 2}px, ${(Math.random() - 0.5) * power * 2}px) rotate(${(Math.random() - 0.5) * power * 0.15}deg)` },
	);
	el.animate(frames, { duration, easing: 'linear' });
}

export function flash(variant: 'white' | 'rainbow' | 'gold' = 'white', duration = 500) {
	const el = document.createElement('div');
	el.className = `fx-flash ${variant}`;
	document.body.append(el);
	el.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration, easing: 'ease-out' }).finished.finally(() => el.remove());
}

/** 画面中央にドーンと出る文字。終わるまで待てる */
export function banner(text: string, variant = 'rainbow', duration = 1200, sub?: string): Promise<void> {
	const el = document.createElement('div');
	el.className = `fx-banner ${variant}`;
	const main = document.createElement('div');
	main.className = 'fx-banner-main';
	main.textContent = text;
	el.append(main);
	if (sub) {
		const s = document.createElement('div');
		s.className = 'fx-banner-sub';
		s.textContent = sub;
		el.append(s);
	}
	document.body.append(el);
	return el
		.animate(
			[
				{ transform: 'translate(-50%, -50%) scale(2.6) rotate(-10deg)', opacity: 0 },
				{ transform: 'translate(-50%, -50%) scale(1) rotate(-4deg)', opacity: 1, offset: 0.18 },
				{ transform: 'translate(-50%, -50%) scale(1.06) rotate(-4deg)', opacity: 1, offset: 0.82 },
				{ transform: 'translate(-50%, -50%) scale(0.7) rotate(0deg)', opacity: 0 },
			],
			{ duration, easing: 'cubic-bezier(.2,.9,.2,1)' },
		)
		.finished.then(
			() => el.remove(),
			() => el.remove(),
		);
}

/** ふわっと浮かんで消える文字 */
export function floatText(x: number, y: number, text: string, cls = '') {
	const el = document.createElement('div');
	el.className = `fx-float ${cls}`;
	el.textContent = text;
	el.style.left = `${x}px`;
	el.style.top = `${y}px`;
	document.body.append(el);
	el.animate(
		[
			{ transform: 'translate(-50%, -50%) scale(.5)', opacity: 0 },
			{ transform: 'translate(-50%, -110%) scale(1.15)', opacity: 1, offset: 0.25 },
			{ transform: 'translate(-50%, -250%) scale(1)', opacity: 0 },
		],
		{ duration: 950, easing: 'ease-out' },
	).finished.finally(() => el.remove());
}

let comboEl: HTMLElement | null = null;

export function comboShow(n: number) {
	if (!comboEl) {
		comboEl = document.createElement('div');
		comboEl.className = 'fx-combo';
		document.body.append(comboEl);
	}
	comboEl.innerHTML = `<b>${n}</b><span>COMBO!!</span>`;
	comboEl.animate([{ transform: 'scale(1.5) rotate(-6deg)' }, { transform: 'scale(1) rotate(-6deg)' }], { duration: 180, easing: 'ease-out' });
}

export function comboHide() {
	comboEl?.remove();
	comboEl = null;
}

export function vibrate(pattern: number | number[]) {
	try {
		navigator.vibrate?.(pattern);
	} catch {
		// 対応していない端末は無視
	}
}
