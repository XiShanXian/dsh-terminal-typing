// dsh-diy-terminal-typing 宿主半边：mock ctx 的最小校验
// 覆盖：工具名匹配（含 * 通配）、终端类 / 读取类 / 任意工具的取文、next() 透传、
//       事件队列、两个 HTTP 路由（events 取事件、mode 切"播什么"）
// 用法：node test_plugin.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, pickText, describeTool, isWantedTool, splitText, modeOf, DEFAULTS } from '../lib/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let fails = 0;
function ok(name, cond, extra) {
	if (cond) { console.log('  ok   ' + name); }
	else { fails += 1; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}

const cfg = Object.assign({}, DEFAULTS);
const cmdOnly = Object.assign({}, cfg, { others: false });

// ── 默认值 ───────────────────────────────────────────────────────
ok('others 默认 true（LLM 发起的都算命令）', DEFAULTS.others === true);
ok('tools 含读取类', ['read', 'grep', 'glob'].every((t) => DEFAULTS.tools.includes(t)));
ok('splitLines 默认 false', DEFAULTS.splitLines === false);
ok('splitMax 默认 6', DEFAULTS.splitMax === 6);
ok('已无外接推送配置（endpoint 已移除）', DEFAULTS.endpoint === undefined);
const m0 = modeOf(DEFAULTS);
ok('modeOf 回报四项', typeof m0.all === 'boolean' && typeof m0.maxLen === 'number'
	&& typeof m0.splitLines === 'boolean' && typeof m0.splitMax === 'number', JSON.stringify(m0));

// ── 工具名匹配 ───────────────────────────────────────────────────
ok('精确匹配 pwsh', isWantedTool('pwsh', cfg.tools));
ok('未列出：write 不匹配白名单', !isWantedTool('write', cfg.tools));
ok('通配 mcp__filesystem__read*',
	isWantedTool('mcp__filesystem__read_text_file', cfg.tools) &&
	isWantedTool('mcp__filesystem__read_media_file', cfg.tools));
ok('通配不误伤 write_file', isWantedTool('mcp__filesystem__write_file', cfg.tools) === false);

// ── 取文：终端类 ─────────────────────────────────────────────────
ok('pwsh 取 command 原文',
	pickText({ name: 'pwsh', arguments: { command: 'Get-ChildItem -Force' } }, cmdOnly) === 'Get-ChildItem -Force');
ok('bash 取 script 字段',
	pickText({ name: 'bash', arguments: { script: 'ls -la' } }, cmdOnly) === 'ls -la');
ok('无参命令回退成工具名', pickText({ name: 'pwsh', arguments: {} }, cmdOnly) === 'pwsh');

// ── 取文：读取类 ─────────────────────────────────────────────────
ok('read 用 file_path 拼行',
	pickText({ name: 'read', arguments: { file_path: 'C:\\docs\\a.md' } }, cmdOnly) === 'read C:\\docs\\a.md');
ok('read 带 offset/limit',
	pickText({ name: 'read', arguments: { file_path: 'C:\\docs\\a.md', offset: 100, limit: 50 } }, cmdOnly) ===
	'read C:\\docs\\a.md [100 +50]');
ok('grep 用 pattern + path + include',
	pickText({ name: 'grep', arguments: { pattern: 'pickRandomPos', path: 'D:\\projects\\demo', include: '*.js' } }, cmdOnly) ===
	'grep "pickRandomPos" D:\\projects\\demo --include=*.js');
ok('glob 用 pattern + path',
	pickText({ name: 'glob', arguments: { pattern: '**/*.md', path: 'D:\\projects\\work' } }, cmdOnly) ===
	'glob "**/*.md" D:\\projects\\work');
ok('mcp 读取类（通配命中）',
	pickText({ name: 'mcp__filesystem__read_text_file', arguments: { path: 'C:\\docs\\x.txt' } }, cmdOnly) ===
	'mcp__filesystem__read_text_file C:\\docs\\x.txt');

// ── 取文：others 开关 ────────────────────────────────────────────
ok('others=false：白名单外的工具不入队',
	pickText({ name: 'write', arguments: { file_path: 'C:\\docs\\x.txt' } }, cmdOnly) === '');
ok('others=true（默认）：任意工具都描述',
	pickText({ name: 'write', arguments: { file_path: 'C:\\docs\\x.txt' } }, cfg) === 'write C:\\docs\\x.txt');
ok('others=true：job 类也描述',
	pickText({ name: 'job_output', arguments: { job_id: 'abc123' } }, cfg) === 'job_output abc123');
ok('maxLen 截断',
	pickText({ name: 'pwsh', arguments: { command: 'x'.repeat(500) } }, Object.assign({}, cfg, { maxLen: 20 })).length === 22);

// ── splitText：多行命令拆开 ──────────────────────────────────────
ok('单行原样返回', JSON.stringify(splitText('echo hi', 6)) === JSON.stringify(['echo hi']));
ok('多行按行拆开', JSON.stringify(splitText('a\nb\nc', 6)) === JSON.stringify(['a', 'b', 'c']));
ok('空行被丢掉', JSON.stringify(splitText('a\n\n  \nb', 6)) === JSON.stringify(['a', 'b']));
ok('超出上限：多余的行并进最后一条', JSON.stringify(splitText('a\nb\nc\nd', 2)) === JSON.stringify(['a', 'b …(还有 2 行)']),
	JSON.stringify(splitText('a\nb\nc\nd', 2)));
ok('行首尾空白被裁', JSON.stringify(splitText('  a  \n  b  ', 6)) === JSON.stringify(['a', 'b']));

// ── apply：注册与队列 ────────────────────────────────────────────
const handlers = {};
const routes = [];
const ctx = {
	on: (ev, fn) => { handlers[ev] = fn; },
	get: (n) => (n === 'webServer' ? { register: (r) => routes.push(r) } : undefined),
};
apply(ctx, { others: false });

function mkReq(method, body) {
	const h = {};
	return {
		method: method,
		on: (ev, fn) => { h[ev] = fn; },
		destroy: () => {},
		fire: () => { if (body !== undefined && h.data) h.data(body); if (h.end) h.end(); },
	};
}
function mkRes() {
	return { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
}
const eventsRoute = routes.find((r) => r.path === '/__diy/terminal-typing/events');
const modeRoute = routes.find((r) => r.path === '/__diy/terminal-typing/mode');
const query = (since) => {
	const r = mkRes();
	eventsRoute.handler({ url: '/__diy/terminal-typing/events?since=' + since }, r);
	return JSON.parse(r.body);
};

ok('注册了 tools/execute', typeof handlers['tools/execute'] === 'function');
ok('注册了 events 路由', !!eventsRoute);
ok('注册了 mode 路由', !!modeRoute);

let nextCalled = 0;
const fire = (exec) => handlers['tools/execute'](exec, () => { nextCalled += 1; });
fire({ name: 'pwsh', arguments: { command: 'echo hi' } });
fire({ name: 'read', arguments: { file_path: 'C:\\docs\\a.md' } });
fire({ name: 'write', arguments: { file_path: 'C:\\docs\\no.md' } });
ok('next() 每条都透传', nextCalled === 3, 'nextCalled=' + nextCalled);

let payload = query(0);
ok('others=false：队列里只有 2 条', payload.events.length === 2, JSON.stringify(payload.events.map((e) => e.text)));
ok('read 事件文本正确', payload.events[1] && payload.events[1].text === 'read C:\\docs\\a.md',
	payload.events[1] && payload.events[1].text);
ok('lastSeq 单调', payload.lastSeq === 2, String(payload.lastSeq));
ok('响应里带 mode', payload.mode && payload.mode.all === false, JSON.stringify(payload.mode));
ok('since 过滤生效', query(2).events.length === 0);

// ── mode 路由：运行时不重启切换"播什么" ──────────────────────────
const rq = mkReq('POST', JSON.stringify({ all: true }));
const rs = mkRes();
modeRoute.handler(rq, rs);
rq.fire();
ok('POST mode 生效', rs.code === 200 && JSON.parse(rs.body).mode.all === true, rs.body);

fire({ name: 'write', arguments: { file_path: 'C:\\docs\\yes.md' } });
payload = query(2);
ok('切到 all=true 后 write 也入队', payload.events.length === 1 && payload.events[0].text === 'write C:\\docs\\yes.md',
	JSON.stringify(payload.events.map((e) => e.text)));
ok('mode 随队列一起回报', payload.mode.all === true, JSON.stringify(payload.mode));

const rq2 = mkReq('GET');
const rs2 = mkRes();
modeRoute.handler(rq2, rs2);
rq2.fire();
ok('非 POST 返回 405', rs2.code === 405, String(rs2.code));

const rq3 = mkReq('POST', JSON.stringify({ all: false }));
const rs3 = mkRes();
modeRoute.handler(rq3, rs3);
rq3.fire();
fire({ name: 'write', arguments: { file_path: 'C:\\docs\\no2.md' } });
ok('切回 all=false 后 write 又不入队', query(0).events.filter((e) => e.text.indexOf('no2') >= 0).length === 0);

const rq4 = mkReq('POST', 'not-json');
const rs4 = mkRes();
modeRoute.handler(rq4, rs4);
rq4.fire();
ok('坏 JSON 返回 400', rs4.code === 400, String(rs4.code));

// ── 拆行开关：一条调用 → 多条事件 ────────────────────────────────
const h2 = {};
const r2 = [];
apply({ on: (ev, fn) => { h2[ev] = fn; }, get: (n) => (n === 'webServer' ? { register: (x) => r2.push(x) } : undefined) },
	{ others: true, splitLines: true, splitMax: 3 });
const evRoute2 = r2.find((x) => x.path === '/__diy/terminal-typing/events');
const q2 = () => {
	const res = mkRes();
	evRoute2.handler({ url: '/__diy/terminal-typing/events?since=0' }, res);
	return JSON.parse(res.body);
};
h2['tools/execute']({ name: 'pwsh', arguments: { command: 'echo one\necho two\necho three\necho four' } }, () => {});
const p2 = q2();
ok('拆行开启：4 行只入 3 条（受 splitMax 限）', p2.events.length === 3, JSON.stringify(p2.events.map((e) => e.text)));
ok('拆出的每条独立成事件',
	p2.events[0].text === 'echo one' && p2.events[1].text === 'echo two',
	JSON.stringify(p2.events.map((e) => e.text)));
ok('超出的行并进最后一条并标注',
	p2.events[2].text.indexOf('echo three') === 0 && p2.events[2].text.indexOf('还有 1 行') > 0,
	p2.events[2].text);
ok('拆出的时间戳相同（同时到达客户端）', p2.events[0].at === p2.events[2].at,
	p2.events[0].at + '/' + p2.events[2].at);

const rq5 = mkReq('POST', JSON.stringify({ splitLines: true, splitMax: 5 }));
const rs5 = mkRes();
modeRoute.handler(rq5, rs5);
rq5.fire();
const m5 = JSON.parse(rs5.body).mode;
ok('mode 可运行时切拆行开关', m5.splitLines === true && m5.splitMax === 5, rs5.body);

// ── 清理核查：外接推送这条线已彻底移除（源码级） ──────────────────
// 断言里的旧端口号 / 旧设备名词一律拼接构造，免得核查脚本自己又把它们写回仓库。
const OLD_PORT = '876' + '5';
const OLD_WORD = '悬浮' + '键盘';
const hostSrc = fs.readFileSync(path.join(HERE, '..', 'lib', 'index.js'), 'utf8');
const clientSrc = fs.readFileSync(path.join(HERE, '..', 'lib', 'client.js'), 'utf8');
ok('宿主源码不再 import node:http', hostSrc.indexOf('node:http') < 0);
ok('宿主源码不再出现旧端口号', hostSrc.indexOf(OLD_PORT) < 0);
ok('宿主源码不再出现旧设备名词', hostSrc.indexOf(OLD_WORD) < 0);
ok('客户端源码同样干净',
	clientSrc.indexOf(OLD_PORT) < 0 && clientSrc.indexOf(OLD_WORD) < 0);

console.log(fails === 0 ? '\nRESULT: OK' : '\nRESULT: ' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);
