// dsh-diy-terminal-typing 客户端半边：不依赖 DSH / 浏览器的校验脚本
//   1) 加载 bundle，验证 __ModuleLoader__ 注册格式与 apply 挂载的两个槽位；
//   2) 校验 DEFAULTS 新字段与 pickRandomPos 的边界 / 避让行为（纯逻辑）。
// 用法：node test_client.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
function ok(name, cond, extra) {
	if (cond) { console.log('  ok   ' + name); }
	else { fails += 1; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}

// ── 最小浏览器环境 ────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
	getItem: (k) => (store.has(k) ? store.get(k) : null),
	setItem: (k, v) => store.set(k, String(v)),
	removeItem: (k) => store.delete(k),
};
const fakeEl = { setAttribute() {}, append() {}, textContent: '', style: {} };
globalThis.document = {
	querySelector: () => null,
	createElement: () => fakeEl,
	head: { append() {} },
};
globalThis.window = { innerWidth: 1440, innerHeight: 900 };
let captured = null;
globalThis.window.__ModuleLoader__ = { load: (m) => { captured = m; } };

// 极简 React 替身：加载期只要求"存在"（memo 打上真 React 的 $$typeof 标记，便于断言）
const React = {
	createElement: (...a) => ({ a }),
	Fragment: Symbol('Fragment'),
	useState: (v) => [v, () => {}],
	useEffect: () => {},
	useLayoutEffect: () => {},
	useMemo: (fn) => fn(),
	useRef: (v) => ({ current: v }),
	useCallback: (f) => f,
	memo: (fn) => { const m = function (p) { return fn(p); }; m.$$typeof = Symbol.for('react.memo'); return m; },
};

await import(pathToFileURL(path.join(dir, '..', 'lib', 'client.js')).href);

ok('bundle 已注册', !!captured);
ok('bundle id 正确', !!captured && captured.id === 'dsh-diy-terminal-typing', captured && captured.id);

const mod = captured.factory((name) => {
	if (name === 'react') return React;
	throw new Error('unexpected require: ' + name);
});

ok('apply 是函数', typeof mod.apply === 'function');
ok('inject 含 timer', Array.isArray(mod.inject) && mod.inject.includes('timer'));

// ── apply：两个槽位都挂上 ────────────────────────────────────────
const regs = [];
const ctx = {
	interval: () => {},
	get: (name) => (name === 'slots' ? {
		inject: (slot, fn) => { if (slot === 'shell.overlay' || slot === 'settings.section') fn(); },
		register: (meta) => { regs.push(meta); return meta; },
	} : undefined),
};
mod.apply(ctx);
ok('挂载 shell.overlay', regs.some((r) => r.name === 'shell.overlay'));
ok('挂载 settings.section', regs.some((r) => r.name === 'settings.section' && r.label === '终端打字'));

// ── 新字段 ───────────────────────────────────────────────────────
const I = mod.__internals;
ok('DEFAULTS.multi 默认 false', I.DEFAULTS.multi === false);
ok('DEFAULTS.multiMax 默认 4', I.DEFAULTS.multiMax === 4);
ok('默认分区 57 键（打字区）', I.keysOf(I.DEFAULTS).length === 57, String(I.keysOf(I.DEFAULTS).length));
ok('pickRandomPos 已导出', typeof I.pickRandomPos === 'function');

// ── pickRandomPos：边界与避让 ─────────────────────────────────────
const seq = [0.5, 0.5, 0.97, 0.03, 0.2, 0.8, 0.6, 0.4];
const mkRand = () => { let i = 0; return () => seq[(i++) % seq.length]; };
const W = 240, H = 120, VW = 1000, VH = 800;
const inside = (r) => r.x >= 10 && r.y >= 10 && r.x + W <= VW && r.y + H <= VH;
const overlap = (p, q) =>
	Math.max(0, Math.min(p.x + W, q.x + W) - Math.max(p.x, q.x)) *
	Math.max(0, Math.min(p.y + H, q.y + H) - Math.max(p.y, q.y));

const a = I.pickRandomPos([], W, H, VW, VH, mkRand());
ok('空场：落在视口内', inside(a), JSON.stringify(a));

const b = I.pickRandomPos([a], W, H, VW, VH, mkRand());
ok('有占位：仍在视口内', inside(b), JSON.stringify(b));
ok('有占位：与已有卡片不重叠', overlap(a, b) === 0, 'overlap=' + overlap(a, b));

const tight = I.pickRandomPos([a], W, H, 260, 140, mkRand());
ok('空间不足：仍落在界内', tight.x === 10 && tight.y === 10, JSON.stringify(tight));

const tiny = I.pickRandomPos([], 2000, 1500, 800, 600, mkRand());
ok('卡片比视口大：退回 pad 起点', tiny.x === 10 && tiny.y === 10, JSON.stringify(tiny));

// ── fixedPos：旧行为不变 ─────────────────────────────────────────
ok('fixedPos 默认 = 右下角',
	JSON.stringify(I.fixedPos(Object.assign({}, I.DEFAULTS))) === JSON.stringify({ right: 18, bottom: 18 }),
	JSON.stringify(I.fixedPos(Object.assign({}, I.DEFAULTS))));
ok('fixedPos 自定义坐标',
	JSON.stringify(I.fixedPos({ corner: 'custom', posX: 10, posY: 20 })) === JSON.stringify({ left: '10%', top: '20%' }));

// ── 命令来源 / 积压保护 ──────────────────────────────────────────
ok('DEFAULTS.allTools 默认 true', I.DEFAULTS.allTools === true);
ok('DEFAULTS.skipStale 默认 true', I.DEFAULTS.skipStale === true);
ok('DEFAULTS.staleMs 默认 8000', I.DEFAULTS.staleMs === 8000);
ok('isStale / takeNext 已导出', typeof I.isStale === 'function' && typeof I.takeNext === 'function');

const now = Date.now();
const st = Object.assign({}, I.DEFAULTS);
ok('刚发生的事件不算陈旧', I.isStale({ at: now - 100 }, now, st) === false);
ok('超过阈值算陈旧', I.isStale({ at: now - 9000 }, now, st) === true);
ok('阈值调大后不算陈旧', I.isStale({ at: now - 9000 }, now, Object.assign({}, st, { staleMs: 20000 })) === false);
ok('关掉开关就不判陈旧', I.isStale({ at: now - 900000 }, now, Object.assign({}, st, { skipStale: false })) === false);

I.pending.length = 0;
I.pending.push({ seq: 1, type: 'type', text: 'old', at: now - 60000 });
I.pending.push({ seq: 2, type: 'type', text: 'fresh', at: now - 100 });
const taken = I.takeNext(st);
ok('takeNext 跳过陈旧、返回新鲜的那条', !!taken && taken.text === 'fresh', taken && taken.text);
ok('陈旧的那条已被丢掉', I.pending.length === 0, String(I.pending.length));
ok('队列空了返回 null', I.takeNext(st) === null);

const calls = [];
globalThis.fetch = async (url, opt) => { calls.push({ url: url, opt: opt }); return { json: async () => ({}) }; };
await I.syncMode({ all: false });
const body0 = JSON.parse(calls[0].opt.body);
ok('syncMode POST 到宿主',
	calls.length === 1 && calls[0].url === '/__diy/terminal-typing/mode' && body0.all === false,
	JSON.stringify(calls));
ok('syncMode 一并推拆行字段',
	body0.splitLines === I.DEFAULTS.splitLines && body0.splitMax === I.DEFAULTS.splitMax, JSON.stringify(body0));

// ── 多行命令拆开（同步给宿主） ───────────────────────────────────
ok('DEFAULTS.splitLines 默认 false', I.DEFAULTS.splitLines === false);
ok('DEFAULTS.splitMax 默认 6', I.DEFAULTS.splitMax === 6);
const pay = I.modePayload({ splitLines: true });
ok('modePayload 默认带三项',
	typeof pay.all === 'boolean' && typeof pay.splitLines === 'boolean' && typeof pay.splitMax === 'number',
	JSON.stringify(pay));
ok('modePayload 可只覆盖单项',
	pay.splitLines === true && pay.all === I.DEFAULTS.allTools, JSON.stringify(pay));

// ── 浮层不透明度 ─────────────────────────────────────────────────
ok('DEFAULTS.opacity 默认 1', I.DEFAULTS.opacity === 1);
ok('clampOpacity 已导出', typeof I.clampOpacity === 'function');
ok('正常值原样', I.clampOpacity(0.6) === 0.6);
ok('超上限钳到 1', I.clampOpacity(3) === 1);
ok('超下限钳到 0.1', I.clampOpacity(0.01) === 0.1);
ok('0 / 非法值当 1（免得看不见还以为坏了）', I.clampOpacity(0) === 1 && I.clampOpacity('x') === 1);

// ── 性能改造：键帽样式缓存 / 高亮绕开 React / 队列封顶 ────────────
ok('键帽样式工厂已导出', typeof I.buildKeyStyles === 'function');
const K57 = I.keysOf(I.DEFAULTS);
const box0 = { minCol: 0, minRow: 0, span: 60, rows: 6 };
const styles = I.buildKeyStyles(I.DEFAULTS, K57, box0);
ok('buildKeyStyles 覆盖全部键', Object.keys(styles).length === K57.length, String(Object.keys(styles).length));
const s0 = styles[K57[0].code];
ok('样式含网格定位/高度/圆角',
	!!s0.gridColumn && !!s0.gridRow && s0.height === I.DEFAULTS.keyH + 'px' && s0.borderRadius === I.DEFAULTS.radius + 'px');
ok('彩虹底色走 --tt-kbg 变量',
	typeof s0['--tt-kbg'] === 'string' && s0['--tt-kbg'].indexOf('linear-gradient') === 0, s0['--tt-kbg']);
ok('样式里不再内联高亮色', s0.background === undefined && s0.color === undefined);
const stylesOff = I.buildKeyStyles(Object.assign({}, I.DEFAULTS, { rainbow: false }), K57, box0);
ok('彩虹关闭时无 --tt-kbg', stylesOff[K57[0].code]['--tt-kbg'] === undefined);

// ── 键盘主体色 / 底板色（自定义配色） ────────────────────────────
ok('DEFAULTS.bodyCustom 默认 false', I.DEFAULTS.bodyCustom === false);
ok('DEFAULTS 主体色是 #RRGGBB',
	I.isHex(I.DEFAULTS.bodyFrom) && I.isHex(I.DEFAULTS.bodyTo), I.DEFAULTS.bodyFrom + '/' + I.DEFAULTS.bodyTo);
ok('DEFAULTS.caseCustom 默认 false', I.DEFAULTS.caseCustom === false && I.isHex(I.DEFAULTS.caseColor));
ok('idleColor / bodyGradient / readableInk / cardStyle 已导出',
	typeof I.idleColor === 'function' && typeof I.bodyGradient === 'function'
	&& typeof I.readableInk === 'function' && typeof I.cardStyle === 'function');

const bodyOn = Object.assign({}, I.DEFAULTS, { bodyCustom: true, bodyFrom: '#204060', bodyTo: '#2A5080' });
const g1 = I.idleColor(bodyOn, K57[0], box0);
const g2 = I.idleColor(bodyOn, K57[K57.length - 1], box0);
ok('自定义主体色＝两色渐变', g1 === 'linear-gradient(160deg, #204060, #2a5080)', g1);
ok('自定义主体色不看列位置（整块键盘同一色）', g1 === g2, g1 + ' vs ' + g2);
ok('自定义主体色盖过 rainbow=false',
	I.idleColor(Object.assign({}, bodyOn, { rainbow: false }), K57[0], box0) === g1);
const stylesBody = I.buildKeyStyles(bodyOn, K57, box0);
ok('bodyCustom 时每颗键帽都挂 --tt-kbg',
	Object.keys(stylesBody).every((c) => typeof stylesBody[c]['--tt-kbg'] === 'string'));
ok('非法色值退回默认色',
	I.bodyGradient({ bodyCustom: true, bodyFrom: 'oops', bodyTo: null })
		=== 'linear-gradient(160deg, ' + I.DEFAULTS.bodyFrom + ', ' + I.DEFAULTS.bodyTo + ')',
	I.bodyGradient({ bodyCustom: true, bodyFrom: 'oops', bodyTo: null }));

ok('深色主体 → 白字', I.readableInk('#20304a', '#2a5080') === '#fff');
ok('浅色主体 → 交给主题字色（null）', I.readableInk('#E9EFF8', '#D3E0F2') === null);
ok('单侧缺失也能判定', I.readableInk('#101010', 'bad') === '#fff' && I.readableInk(null, null) === null);
ok('hexLum 边界',
	Math.abs(I.hexLum('#ffffff') - 1) < 1e-9 && Math.abs(I.hexLum('#000000')) < 1e-9 && I.hexLum('x') === null);

ok('底板未自定义 → 跟随主题', I.caseColorOf(I.DEFAULTS) === null);
const caseOn = Object.assign({}, I.DEFAULTS, { caseCustom: true, caseColor: '#123456' });
ok('底板自定义 → 取到色值', I.caseColorOf(caseOn) === '#123456');
const cs = I.cardStyle(caseOn, 'min(300px,84vw)');
ok('cardStyle 带宽高与 --tt-case', cs.width === 'min(300px,84vw)' && cs['--tt-case'] === '#123456', JSON.stringify(cs));
ok('cardStyle 未自定义时不挂 --tt-case', I.cardStyle(I.DEFAULTS, '100%')['--tt-case'] === undefined);

ok('CSS：键帽底色走 --tt-kbg 回退', I.CSS.indexOf('var(--tt-kbg,var(--dsw-alias-bg-layer-2') > 0);
ok('CSS：键帽文字走 --tt-ktext 回退', I.CSS.indexOf('var(--tt-ktext,var(--dsw-alias-label-secondary') > 0);
ok('CSS：卡片底板走 --tt-case 回退', I.CSS.indexOf('var(--tt-case,var(--dsw-alias-bg-layer-1') > 0);
ok('CSS：高亮仍压过自定义主体色',
	I.CSS.indexOf('.tt-key.lit{background:linear-gradient') > 0);

ok('KeyCap 被 memo 包裹', !!I.KeyCap && I.KeyCap.$$typeof === Symbol.for('react.memo'));
ok('TypeLane 被 memo 包裹', !!I.TypeLane && I.TypeLane.$$typeof === Symbol.for('react.memo'));

ok('makeLitController 已导出', typeof I.makeLitController === 'function');
function mkEl() {
	const set = new Set();
	return { classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), has: (c) => set.has(c) } };
}
const elA = mkEl(), elB = mkEl();
const ctl = I.makeLitController({ KeyA: elA, KeyB: elB });
ctl.set('KeyA', true);
ok('点亮 = 加 .lit 类', elA.classList.has('lit') && !elB.classList.has('lit'));
ctl.set('KeyA', false);
ok('熄灭 = 去 .lit 类', !elA.classList.has('lit'));
ctl.set('KeyA', true); ctl.set('KeyB', true);
ctl.clear();
ok('clear 清掉全部高亮', !elA.classList.has('lit') && !elB.classList.has('lit'));
ctl.set('Missing', true);
ok('未知键不抛错', true);

const hits = [];
await I.playText('Hi', 1000, { cps: 1000, litHold: 20 }, (code, on) => hits.push(code + (on ? '+' : '-')), () => true);
await new Promise((r) => setTimeout(r, 80));
ok('playText 按下 KeyH 且带 Shift', hits.indexOf('KeyH+') >= 0 && hits.indexOf('ShiftLeft+') >= 0, hits.join(' '));
ok('playText 依次按下 KeyI', hits.indexOf('KeyI+') >= 0, hits.join(' '));
ok('playText 会抬起按键', hits.indexOf('KeyH-') >= 0 && hits.indexOf('KeyI-') >= 0, hits.join(' '));

ok('PENDING_MAX = 300', I.PENDING_MAX === 300);
const big = [];
for (let i = 0; i < 350; i += 1) big.push(i);
I.capPending(big, I.PENDING_MAX);
ok('capPending 丢最旧、保尾部', big.length === 300 && big[0] === 50 && big[299] === 349, big.length + '/' + big[0]);
ok('未超限则原样', I.capPending([1, 2, 3], I.PENDING_MAX).length === 3);

console.log(fails === 0 ? '\nRESULT: OK' : '\nRESULT: ' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);
