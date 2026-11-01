// dsh-diy-terminal-typing 浏览器侧 bundle（客户端模块系统格式）
//
// 在 DSH 界面角落挂一个浮层：LLM 每次发起终端命令，浮层淡入，把命令逐字符
// "敲"在迷你键盘上（对应键位高亮），结束后淡出。数据来自宿主半边注册的
// GET /__diy/terminal-typing/events。
//
// 设置 → 终端打字：分区开关（F 区/主键区/导航/小键盘 + 主键区精简）、外观
// （宽度/键高/字号/圆角/键距/文字/彩虹或自定义主体色/底板色/高亮色）、动画（速度/高亮时长/停留/淡入淡出）、
// 命令条、浮现位置（四角或自定义坐标），并带**实时预览**与"试打"。选择持久化到 localStorage。
window.__ModuleLoader__.load({
	id: "dsh-diy-terminal-typing",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		// ================================================================== 布局
		// 99 键布局：80 列 × 6 行，1u = 4 列。
		// 每个键带 zone：fn（F 区）/ main（主键区）/ nav（方向键+导航）/ pad（小键盘）
		function buildLayout() {
			const keys = [];
			const row = (r, defs, offset, zone) => {
				let col = offset;
				for (const d of defs) {
					if (typeof d === "number") { col += Math.round(d * 4); continue; }
					const code = d[0], label = d[1], w = d[2] || 1, rs = d[3] || 1;
					const cols = Math.round(w * 4);
					keys.push({ code, label, row: r, col, cols, rs, zone });
					col += cols;
				}
			};
			row(0, [["Escape", "Esc"], 0.5, ["F1", "F1"], ["F2", "F2"], ["F3", "F3"], ["F4", "F4"], 0.25,
				["F5", "F5"], ["F6", "F6"], ["F7", "F7"], ["F8", "F8"], 0.25,
				["F9", "F9"], ["F10", "F10"], ["F11", "F11"], ["F12", "F12"], ["BrandKey", "*"]], 0, "fn");
			row(1, [["Backquote", "`"], ["Digit1", "1"], ["Digit2", "2"], ["Digit3", "3"], ["Digit4", "4"],
				["Digit5", "5"], ["Digit6", "6"], ["Digit7", "7"], ["Digit8", "8"], ["Digit9", "9"],
				["Digit0", "0"], ["Minus", "-"], ["Equal", "="], ["Backspace", "Bksp", 2]], 0, "main");
			row(2, [["Tab", "Tab", 1.5], ["KeyQ", "Q"], ["KeyW", "W"], ["KeyE", "E"], ["KeyR", "R"],
				["KeyT", "T"], ["KeyY", "Y"], ["KeyU", "U"], ["KeyI", "I"], ["KeyO", "O"], ["KeyP", "P"],
				["BracketLeft", "["], ["BracketRight", "]"], ["Backslash", "\\", 1.5]], 0, "main");
			row(3, [["CapsLock", "Caps", 1.75], ["KeyA", "A"], ["KeyS", "S"], ["KeyD", "D"], ["KeyF", "F"],
				["KeyG", "G"], ["KeyH", "H"], ["KeyJ", "J"], ["KeyK", "K"], ["KeyL", "L"],
				["Semicolon", ";"], ["Quote", "'"], ["Enter", "Enter", 2.25]], 0, "main");
			row(4, [["ShiftLeft", "Shift", 2.25], ["KeyZ", "Z"], ["KeyX", "X"], ["KeyC", "C"], ["KeyV", "V"],
				["KeyB", "B"], ["KeyN", "N"], ["KeyM", "M"], ["Comma", ","], ["Period", "."],
				["Slash", "/"], ["ShiftRight", "Shift", 1.75]], 0, "main");
			row(5, [["ControlLeft", "Ctrl", 1.25], ["MetaLeft", "Win", 1.25], ["AltLeft", "Alt", 1.25],
				["Space", "Space", 5.5], ["AltRight", "Alt", 1.25], ["Fn", "Fn", 1.25],
				["ControlRight", "Ctrl", 1.25]], 0, "main");
			row(4, [1, ["ArrowUp", "\u2191"]], 54, "nav");
			row(5, [["ArrowLeft", "\u2190"], ["ArrowDown", "\u2193"], ["ArrowRight", "\u2192"]], 54, "nav");
			row(0, [["Delete", "DEL"], ["Insert", "INS"], ["PageUp", "PU"], ["PageDown", "PD"]], 64, "nav");
			row(1, [["NumLock", "NUM"], ["NumpadDivide", "/"], ["NumpadMultiply", "*"], ["NumpadSubtract", "-"]], 64, "pad");
			row(2, [["Numpad7", "7"], ["Numpad8", "8"], ["Numpad9", "9"], ["NumpadAdd", "+", 1, 2]], 64, "pad");
			row(3, [["Numpad4", "4"], ["Numpad5", "5"], ["Numpad6", "6"]], 64, "pad");
			row(4, [["Numpad1", "1"], ["Numpad2", "2"], ["Numpad3", "3"], ["NumpadEnter", "Enter", 1, 2]], 64, "pad");
			row(5, [1, ["Numpad0", "0"], ["NumpadDecimal", "."]], 64, "pad");
			return keys;
		}
		const LAYOUT = buildLayout();

		// "主键区精简"会去掉的这些键：命令里基本用不到（Ctrl/Alt 偶尔用，Win/Fn/Caps 几乎不用）
		const SLIM_SKIP = ["MetaLeft", "Fn", "CapsLock"];
		const ZONE_LABELS = { fn: "F 区", main: "主键区", nav: "方向/导航", pad: "小键盘" };

		function keysOf(opt) {
			const zones = opt.zones || {};
			return LAYOUT.filter((k) => {
				if (!zones[k.zone]) return false;
				if (k.zone === "main" && opt.slim && SLIM_SKIP.indexOf(k.code) >= 0) return false;
				return true;
			});
		}
		// 预设：一键切到常见组合
		const PRESETS = {
			typing: { label: "打字区", zones: { fn: false, main: true, nav: false, pad: false }, slim: true },
			main: { label: "主键区", zones: { fn: false, main: true, nav: false, pad: false }, slim: false },
			full: { label: "完整键盘", zones: { fn: true, main: true, nav: true, pad: true }, slim: false },
			nopad: { label: "无小键盘", zones: { fn: true, main: true, nav: true, pad: false }, slim: false },
		};

		const CHAR2KEY = (function () {
			const m = {};
			for (const c of "abcdefghijklmnopqrstuvwxyz") {
				m[c] = ["Key" + c.toUpperCase(), false];
				m[c.toUpperCase()] = ["Key" + c.toUpperCase(), true];
			}
			for (const c of "1234567890") m[c] = ["Digit" + c, false];
			Object.assign(m, {
				" ": ["Space", false], "\n": ["Enter", false], "\t": ["Tab", false],
				"-": ["Minus", false], "=": ["Equal", false], "[": ["BracketLeft", false],
				"]": ["BracketRight", false], "\\": ["Backslash", false], ";": ["Semicolon", false],
				"'": ["Quote", false], ",": ["Comma", false], ".": ["Period", false],
				"/": ["Slash", false], "`": ["Backquote", false],
				"!": ["Digit1", true], "@": ["Digit2", true], "#": ["Digit3", true],
				"$": ["Digit4", true], "%": ["Digit5", true], "^": ["Digit6", true],
				"&": ["Digit7", true], "*": ["Digit8", true], "(": ["Digit9", true],
				")": ["Digit0", true], "_": ["Minus", true], "+": ["Equal", true],
				"{": ["BracketLeft", true], "}": ["BracketRight", true], "|": ["Backslash", true],
				":": ["Semicolon", true], '"': ["Quote", true], "<": ["Comma", true],
				">": ["Period", true], "?": ["Slash", true], "~": ["Backquote", true]
			});
			return m;
		})();

		// ================================================================== 状态
		const LS_KEY = "dsh-diy-terminal-typing";
		const DEFAULTS = {
			enabled: true,
			// 分区
			zones: { fn: false, main: true, nav: false, pad: false },
			slim: true,
			// 动画
			cps: 45, litHold: 70, hold: 1600, fade: 180,
			// 外观
			width: 0, keyH: 19, fontSize: 8, radius: 3, gap: 1, labels: true,
			rainbow: true, litFrom: "#7FB8FF", litTo: "#6FE6DE",
			// 键盘主体配色：自定义时盖过"淡彩彩虹"与主题键帽色（字色按明暗自动配）
			bodyCustom: false, bodyFrom: "#E9EFF8", bodyTo: "#D3E0F2",
			// 键盘底板（卡片背景）色：自定义时盖过主题
			caseCustom: false, caseColor: "#FFFFFF",
			opacity: 1,          // 浮层整体不透明度（0.1–1）；只影响观感，浮层本来就 pointer-events:none
			// 命令条
			showCmd: true, cmdSize: 12,
			// 位置
			corner: "br", margin: 18, posX: 50, posY: 50,
			// 多命令：每条命令一块键盘、视口内随机落位（false = 单键盘顺序播放、位置按上面的设置）
			multi: false, multiMax: 4,
			// 命令来源：true = LLM 的所有工具调用都播（切换时会同步给宿主）；false = 只播命令类
			allTools: true,
			// 积压保护：排队太久的事件不补播，免得键盘一直在追赶几十秒前的命令
			skipStale: true, staleMs: 8000,
			// 多行命令拆开（切换时同步给宿主）：一条调用里的 N 行 → N 块键盘同时敲
			splitLines: false, splitMax: 6,
		};
		const PRESET_OF = { "typing": "typing", "main": "main", "full": "full" };
		function loadState() {
			let saved = null;
			try {
				const raw = localStorage.getItem(LS_KEY);
				if (raw) saved = JSON.parse(raw);
			} catch (e) { /* localStorage 不可用，或内容已损坏：退回默认值 */ }
			if (!saved || typeof saved !== "object") saved = {};
			// 兼容旧版：只存了 keys:"typing|main|full"、没有 zones 的配置 → 迁移为 zones + slim。
			// 必须先判断 saved 本身：DEFAULTS 自带 zones，若先合并再判断，这个分支永远进不去。
			if (!saved.zones && saved.keys) {
				const p = PRESETS[PRESET_OF[saved.keys] || "typing"];
				if (p) { saved.zones = Object.assign({}, p.zones); saved.slim = p.slim; }
			}
			const s = Object.assign({}, DEFAULTS, saved);
			// zones 必须是完整四分区：旧配置可能只存了其中一两个键，缺的按默认补齐，
			// 否则 keysOf() 会过滤出空数组，键盘整块空白。
			s.zones = Object.assign({}, DEFAULTS.zones, (s.zones && typeof s.zones === "object") ? s.zones : {});
			return s;
		}
		let state = loadState();
		function saveState() {
			try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
		}
		const listeners = new Set();
		function setState(patch) {
			state = Object.assign({}, state, patch);
			saveState();
			listeners.forEach((fn) => { try { fn(state); } catch (e) { /* ignore */ } });
		}
		function useStore() {
			const [st, setSt] = React.useState(state);
			React.useEffect(() => {
				const fn = (s) => setSt(Object.assign({}, s));
				listeners.add(fn);
				return () => { listeners.delete(fn); };
			}, []);
			return st;
		}

		// ================================================================== 事件源
		const pending = [];
		const PENDING_MAX = 300;   // 本地队列上限：浮层关着、或窗口在后台被节流时也不让它无界增长
		let lastSeq = 0;

		// 队列封顶（丢最旧的）。纯函数，便于校验。
		function capPending(arr, max) {
			if (arr.length > max) arr.splice(0, arr.length - max);
			return arr;
		}

		// 轮询守卫：上一轮还没回来就跳过。否则 700ms 内会发出两个带同一 since 的请求，
		// 同一批事件被入队两次，表现就是同一条命令被敲两遍。
		let polling = false;
		// 首次成功取数只用来对齐游标：刷新页面不该把此前积压的命令重播一遍。
		let warmed = false;

		async function poll() {
			if (polling) return;
			polling = true;
			try {
				const res = await fetch("/__diy/terminal-typing/events?since=" + lastSeq, { cache: "no-store" });
				if (!res.ok) return;   // 404/500：宿主未就绪或路由没挂上，下一轮再试
				const data = await res.json();
				if (!data || !Array.isArray(data.events)) return;
				const advance = () => {
					if (typeof data.lastSeq === "number" && data.lastSeq > lastSeq) lastSeq = data.lastSeq;
				};
				if (!warmed) {   // 第一次成功取数：只推进游标，丢弃这批历史
					warmed = true;
					advance();
					return;
				}
				// 游标先推进：即使这批不收（浮层关着），下一轮也不再重复拉同一批
				const prevSeq = lastSeq;
				advance();
				if (!state.enabled) {   // 浮层关着：不攒事件，直接丢
					pending.length = 0;
					return;
				}
				for (const ev of data.events) {
					// seq > prevSeq 用于去重：同一批被重复拉取时不会再次入队
					if (ev && ev.type === "type" && ev.text && ev.seq > prevSeq) pending.push(ev);
				}
				capPending(pending, PENDING_MAX);
			} catch (e) { /* 宿主未就绪：静默 */ }
			finally { polling = false; }
		}

		// 排队太久的事件不补播（改设置或窗口不在前台时，队列可能积压几十条）
		function isStale(ev, now, opt) {
			return !!(opt && opt.skipStale && ev && ev.at && (now - ev.at) > (opt.staleMs || 8000));
		}
		// 从队列取一条"还新鲜"的事件；全是陈旧的就把它们丢掉并返回 null
		function takeNext(opt) {
			while (pending.length > 0) {
				const ev = pending.shift();
				if (isStale(ev, Date.now(), opt)) continue;
				return ev;
			}
			return null;
		}
		// 把设置页的选项推给宿主（改的是运行时过滤条件，不写盘、不重启）
		function modePayload(over) {
			return Object.assign({
				all: !!state.allTools,
				splitLines: !!state.splitLines,
				splitMax: Math.max(1, Number(state.splitMax) || 6),
			}, over || {});
		}
		async function syncMode(over) {
			try {
				await fetch("/__diy/terminal-typing/mode", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(modePayload(over)),
				});
			} catch (e) { /* 宿主未就绪：静默 */ }
		}

		// ================================================================== 键盘渲染
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

		function layoutBox(keys) {
			let minCol = 1e9, maxCol = 0, minRow = 1e9, maxRow = 0;
			for (const k of keys) {
				minCol = Math.min(minCol, k.col);
				maxCol = Math.max(maxCol, k.col + k.cols);
				minRow = Math.min(minRow, k.row);
				maxRow = Math.max(maxRow, k.row + k.rs);
			}
			return {
				minCol, minRow,
				span: Math.max(1, maxCol - minCol),
				rows: Math.max(1, maxRow - minRow),
			};
		}

		// #RRGGBB 校验与兜底（设置页取色器给的就是这个格式；非法值退回默认色）
		function isHex(c) {
			return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);
		}
		function hexOr(v, fallback) {
			return isHex(v) ? v.toLowerCase() : fallback;
		}
		// #RRGGBB 的相对亮度（0–1）：用来决定键帽文字该用白字还是主题字色
		function hexLum(hex) {
			if (!isHex(hex)) return null;
			const n = parseInt(hex.slice(1), 16);
			const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;
		}
		// 键帽文字色：主体偏暗 → 白字；否则 null（交给主题的 label-secondary）。纯函数，便于校验。
		function readableInk(from, to) {
			const a = hexLum(from), b = hexLum(to);
			if (a === null && b === null) return null;
			const lum = (a === null) ? b : (b === null) ? a : (a + b) / 2;
			return lum < 0.55 ? "#fff" : null;
		}
		// 键帽主体色：自定义时所有键帽共用一条渐变（不看列位置），盖过彩虹与主题键帽色
		function bodyGradient(opt) {
			return "linear-gradient(160deg, " + hexOr(opt.bodyFrom, DEFAULTS.bodyFrom)
				+ ", " + hexOr(opt.bodyTo, DEFAULTS.bodyTo) + ")";
		}
		// 键盘底板（卡片）色：自定义时返回色值，否则 null（跟随主题）
		function caseColorOf(opt) {
			return opt.caseCustom ? hexOr(opt.caseColor, DEFAULTS.caseColor) : null;
		}
		// 卡片内联样式：宽度由键盘决定；底板色自定义时挂 --tt-case 给 .tt-card
		function cardStyle(opt, width) {
			const s = { width: width, transitionDuration: (opt.fade || 180) + "ms" };
			const c = caseColorOf(opt);
			if (c) s["--tt-case"] = c;
			return s;
		}
		function idleColor(opt, k, box) {
			if (opt.bodyCustom) return bodyGradient(opt);
			if (!opt.rainbow) return null;
			// 淡彩彩虹：按列位置取色相，低饱和高明度，跟浅色主题也搭
			const hue = ((k.col + k.cols / 2 - box.minCol) / box.span) * 300 + 190;
			return "linear-gradient(160deg, hsl(" + hue.toFixed(0) + ",72%,91%), hsl(" + ((hue + 34) % 360).toFixed(0) + ",68%,86%))";
		}

		// 卡片/键盘的宽度（px）：显式定宽，命令条才能在其中换行而不是把它撑开
		function kbWidthPx(opt, box) {
			return Math.round(opt.width > 0 ? opt.width : box.span * 10.6);
		}

		// 浮层不透明度：钳到 0.1–1；0 或非法值当 1（免得整个浮层看不见了还以为坏了）
		function clampOpacity(v) {
			const n = Number(v);
			if (!isFinite(n) || n <= 0) return 1;
			return Math.min(1, Math.max(0.1, n));
		}

		// 键帽的静态样式：只依赖外观设置（与 lit 无关），所以能缓存、帧间复用。
		// 高亮不走内联样式——内联 background 会盖住类规则，所以 idle 底色的渐变串挂到
		// CSS 变量 --tt-kbg 上，点亮时只切换 .lit 类（见 CSS 段）。纯函数，便于校验。
		function buildKeyStyles(opt, keys, box) {
			const out = {};
			for (const k of keys) {
				const style = {
					gridColumn: (k.col - box.minCol + 1) + " / span " + k.cols,
					gridRow: (k.row - box.minRow + 1) + " / span " + k.rs,
					height: opt.keyH + "px",
					borderRadius: opt.radius + "px",
					fontSize: opt.labels ? opt.fontSize + "px" : "0",
				};
				const idle = idleColor(opt, k, box);
				if (idle) style["--tt-kbg"] = idle;
				out[k.code] = style;
			}
			return out;
		}

		// 单个键帽：memo + 稳定 style 引用 → 键盘重绘时绝大多数键帽原地不动。
		// 高亮不在这里管（交给 makeLitController 直接改 class），所以这里 className 恒定，
		// React 也不会去覆盖 DOM 上后加的 .lit。
		const KeyCap = React.memo(function KeyCap(props) {
			const setRef = React.useCallback((el) => { props.register(props.code, el); }, [props.register, props.code]);
			return React.createElement("div", {
				ref: setRef,
				className: "tt-key",
				style: props.style,
				title: props.label,
			}, props.label);
		});

		function KeyboardGrid(props) {
			const opt = props.opt;
			// keys / box / styles 三样都缓存：设置不变时键帽 props 完全稳定，
			// 配合 memo，键盘只在"键位集合或外观变了"时才真正重绘。
			const keys = React.useMemo(() => props.keys || keysOf(opt), [props.keys, opt.zones, opt.slim]);
			const box = React.useMemo(() => layoutBox(keys), [keys]);
			const styles = React.useMemo(
				() => buildKeyStyles(opt, keys, box),
				[keys, box, opt.keyH, opt.radius, opt.fontSize, opt.labels, opt.rainbow,
					opt.bodyCustom, opt.bodyFrom, opt.bodyTo],
			);
			// 键帽元素注册表（打字时直接点灯用）；reg 缺省则只渲染、不点灯
			const reg = props.reg;
			const register = React.useCallback((code, el) => {
				if (!reg) return;
				if (el) reg.current[code] = el; else delete reg.current[code];
			}, [reg]);
			// 宽度一律由外层卡片决定（浮层=min(键盘宽,84vw)；预览=min(键盘宽,容器宽)），
			// 这样命令条能跟键盘同宽并正常换行，而不会反过来把容器撑宽。
			// 键盘容器上的 CSS 变量：高亮配色 +（自定义主体色时）自动判定出的键帽文字色
			const kbStyle = React.useMemo(() => {
				const s = {
					gridTemplateColumns: "repeat(" + box.span + ",1fr)",
					gridTemplateRows: "repeat(" + box.rows + ",auto)",
					gap: (opt.gap || 0) + "px",
					width: "100%",
					"--tt-lit-from": opt.litFrom,
					"--tt-lit-to": opt.litTo,
				};
				if (opt.bodyCustom) {
					const ink = readableInk(hexOr(opt.bodyFrom, DEFAULTS.bodyFrom), hexOr(opt.bodyTo, DEFAULTS.bodyTo));
					if (ink) s["--tt-ktext"] = ink;
				}
				return s;
			}, [box.span, box.rows, opt.gap, opt.litFrom, opt.litTo,
				opt.bodyCustom, opt.bodyFrom, opt.bodyTo]);

			return React.createElement("div", {
				className: "tt-kb" + (props.className ? " " + props.className : ""),
				style: kbStyle,
			}, keys.map((k) => React.createElement(KeyCap, {
				key: k.code, code: k.code, style: styles[k.code], label: k.label, register: register,
			})));
		}

		// 高亮控制器：直接把 .lit 类写到对应键帽元素上，**完全不经过 React**。
		// 一次按键 = 2 次 classList 操作，键盘的重绘成本与打字帧数彻底脱钩。
		// store 是 { code: element } 注册表，由 KeyboardGrid 里键帽的 ref 填充。
		function makeLitController(store) {
			const set = (code, on) => {
				const el = store && store[code];
				if (!el || !el.classList) return;
				if (on) el.classList.add("lit"); else el.classList.remove("lit");
			};
			return {
				set: set,
				clear: () => {
					if (!store) return;
					for (const code of Object.keys(store)) set(code, false);
				},
			};
		}

		// 打字播放：把 text 逐字符点亮（浮层与预览共用）。hit(code, on) 由调用方的控制器提供。
		function playText(text, cps, opt, hit, isAlive) {
			const interval = Math.max(6, 1000 / Math.max(1, cps || opt.cps || 45));
			let i = 0;
			return (async function step() {
				while (i < text.length) {
					if (isAlive && !isAlive()) return;
					const mapped = CHAR2KEY[text[i]];
					i += 1;
					if (mapped) {
						const c0 = mapped[0], sh = mapped[1];
						hit(c0, true);
						if (sh) hit("ShiftLeft", true);
						setTimeout(() => {
							hit(c0, false);
							if (sh) hit("ShiftLeft", false);
						}, Math.max(20, opt.litHold || 70));
					}
					await sleep(interval);
				}
			})();
		}

		const DEMO = 'pwsh -NoProfile -Command "Get-ChildItem -Force | Select-Object Name,Length"';

		// ================================================================== 浮层
		// 固定位置（旧行为）：四角或自定义坐标
		function fixedPos(st) {
			const m = st.margin || 18;
			return st.corner === "custom"
				? { left: (st.posX || 0) + "%", top: (st.posY || 0) + "%" }
				: st.corner === "bl" ? { left: m, bottom: m }
					: st.corner === "tr" ? { right: m, top: m }
						: st.corner === "tl" ? { left: m, top: m }
							: { right: m, bottom: m };
		}

		// 随机位置：在 vw×vh 视口里给 w×h 的卡片挑一处，尽量不压住已有卡片。
		// 纯函数、rand 由外部注入，便于校验；返回的 rect 由调用方登记与注销。
		function pickRandomPos(existing, w, h, vw, vh, rand) {
			const pad = 10;
			const maxX = Math.max(pad, vw - w - pad);
			const maxY = Math.max(pad, vh - h - pad);
			let best = { x: pad, y: pad };
			let bestWorst = Number.MAX_SAFE_INTEGER;  // 目标：与已有卡片的最大重叠面积尽可能小
			for (let i = 0; i < 14; i += 1) {
				const x = pad + rand() * (maxX - pad);
				const y = pad + rand() * (maxY - pad);
				let worst = 0;
				for (const r of (existing || [])) {
					const ox = Math.max(0, Math.min(x + w, r.x + r.w) - Math.max(x, r.x));
					const oy = Math.max(0, Math.min(y + h, r.y + r.h) - Math.max(y, r.y));
					worst = Math.max(worst, ox * oy);
				}
				if (worst < bestWorst) { bestWorst = worst; best = { x: x, y: y }; }
				if (worst === 0) break;               // 完全不压住任何已有卡片，收工
			}
			return { x: Math.round(best.x), y: Math.round(best.y), w: w, h: h };
		}

		// 一块浮层卡片（命令条 + 键盘），位置与可见性由外层给
		function OverlayCard(props) {
			const st = props.opt;
			const kids = [];
			if (st.showCmd) {
				const cmd = String(props.text || "");
				kids.push(React.createElement("div", {
					key: "cmd", className: "tt-cmd", style: { fontSize: (st.cmdSize || 12) + "px" },
				}, React.createElement("b", null, "\u2328 LLM"), " ",
					cmd.length > 96 ? "\u2026" + cmd.slice(-96) : cmd));
			}
			kids.push(React.createElement(KeyboardGrid, { key: "kb", opt: st, reg: props.reg }));
			const w = kbWidthPx(st, layoutBox(keysOf(st)));
			return React.createElement("div", {
				ref: props.cardRef,
				className: "tt-layer" + (props.visible ? " on" : ""),
				// 整体不透明度挂在最外层；淡入淡出交给内层 .tt-card（见 CSS 段），两者互不打架
				style: Object.assign({ opacity: clampOpacity(st.opacity) }, props.pos),
			}, React.createElement("div", {
				className: "tt-card",
				style: cardStyle(st, "min(" + w + "px,84vw)"),
			}, kids));
		}

		// 旧行为：一块键盘，命令按到达顺序一条条打完，位置按设置固定
		function SingleOverlay(props) {
			const [visible, setVisible] = React.useState(false);
			const [cmd, setCmd] = React.useState("");
			// 键帽注册表 + 高亮控制器：打字时直接改 class，不触发 React 重渲染
			const regRef = React.useRef({});
			const litCtl = React.useMemo(() => makeLitController(regRef.current), []);

			React.useEffect(() => {
				let alive = true;
				const busy = { current: false };
				(async function loop() {
					while (alive) {
						if (busy.current || pending.length === 0 || !state.enabled || state.multi) {
							await sleep(180);
							continue;
						}
						const ev = takeNext(state);
						if (!ev) { await sleep(180); continue; }
						busy.current = true;
						try {
							const text = String(ev.text || "");
							setCmd(text);
							setVisible(true);
							await playText(text, ev.cps > 0 ? ev.cps : state.cps, state, litCtl.set, () => alive);
							await sleep(state.hold);
							setVisible(false);
						} finally {
							busy.current = false;
						}
					}
				})();
				return () => { alive = false; };
			}, []);

			return React.createElement(OverlayCard, {
				opt: props.opt, text: cmd, reg: regRef, visible: visible, pos: fixedPos(props.opt),
			});
		}

		// 多键盘：每条命令一块键盘，视口内随机落位，各自独立播放
		// memo：父组件每次增删 lane 都会重渲染，已在播的 lane 靠浅比较跳过
		const TypeLane = React.memo(function TypeLane(props) {
			const st = props.opt;            // 创建时的设置快照：播放中改设置不会撕裂动画
			const regRef = React.useRef({});
			const litCtl = React.useMemo(() => makeLitController(regRef.current), []);
			const [visible, setVisible] = React.useState(false);
			const [pos, setPos] = React.useState(null);
			const cardRef = React.useRef(null);
			const rectRef = React.useRef(null);
			const alive = React.useRef(true);

			// 先以不可见挂载，量出真实尺寸再随机落位（避免出界、尽量不重叠）
			React.useLayoutEffect(() => {
				const el = cardRef.current;
				const w = (el && el.offsetWidth) || 260;
				const h = (el && el.offsetHeight) || 120;
				const box = props.placed;
				const r = pickRandomPos(box.current, w, h, window.innerWidth, window.innerHeight, Math.random);
				rectRef.current = r;
				box.current = box.current.concat([r]);
				setPos({ left: r.x + "px", top: r.y + "px" });
				setVisible(true);
				return () => {
					alive.current = false;
					if (rectRef.current) box.current = box.current.filter((x) => x !== rectRef.current);
				};
			}, []);

			React.useEffect(() => {
				alive.current = true;
				(async function run() {
					await playText(props.text, props.cps > 0 ? props.cps : st.cps, st, litCtl.set, () => alive.current);
					if (!alive.current) return;
					await sleep(st.hold);
					if (!alive.current) return;
					setVisible(false);
					await sleep(st.fade || 180);
					if (alive.current) props.onDone(props.id);
				})();
				return () => { alive.current = false; };
			}, []);

			return React.createElement(OverlayCard, {
				opt: st, text: props.text, reg: regRef, cardRef: cardRef,
				visible: visible && !!pos, pos: pos || { left: "-9999px", top: "-9999px" },
			});
		});

		function MultiLanes() {
			const [lanes, setLanes] = React.useState([]);
			const placed = React.useRef([]);
			const count = React.useRef(0);
			const seq = React.useRef(0);

			const onDone = React.useCallback((id) => {
				count.current = Math.max(0, count.current - 1);
				setLanes((ls) => ls.filter((l) => l.id !== id));
			}, []);

			React.useEffect(() => {
				let alive = true;
				(async function loop() {
					while (alive) {
						const max = Math.max(1, Number(state.multiMax) || 4);
						if (pending.length === 0 || !state.enabled || !state.multi || count.current >= max) {
							await sleep(140);
							continue;
						}
						const ev = takeNext(state);
						if (!ev) { await sleep(140); continue; }
						seq.current += 1;
						count.current += 1;
						const lane = {
							id: seq.current,
							text: String(ev.text || ""),
							cps: Number(ev.cps) || 0,
							opt: Object.assign({}, state),
						};
						setLanes((ls) => ls.concat([lane]));
					}
				})();
				return () => { alive = false; };
			}, []);

			return React.createElement(React.Fragment, null, lanes.map((l) =>
				React.createElement(TypeLane, {
					key: l.id, id: l.id, text: l.text, cps: l.cps, opt: l.opt,
					placed: placed, onDone: onDone,
				})));
		}

		function TypeOverlay() {
			const st = useStore();
			if (!st.enabled) return null;
			return st.multi
				? React.createElement(MultiLanes, null)
				: React.createElement(SingleOverlay, { opt: st });
		}

		// ================================================================== 设置页
		function Slider(props) {
			const step = props.step || 1;
			const clamp = (v) => Math.min(props.max, Math.max(props.min, Number((v).toFixed(4))));
			const nudge = (dir) => props.onChange(clamp(props.value + dir * step));
			return React.createElement("div", { className: "tt-row" },
				React.createElement("span", { className: "tt-label" }, props.label),
				React.createElement("button", {
					className: "tt-step", title: "减 " + step, onClick: () => nudge(-1),
				}, "\u2212"),
				React.createElement("input", {
					type: "range", min: props.min, max: props.max, step: step,
					value: props.value, onChange: (e) => props.onChange(Number(e.target.value)),
				}),
				React.createElement("button", {
					className: "tt-step", title: "加 " + step, onClick: () => nudge(1),
				}, "+"),
				React.createElement("span", { className: "tt-num" }, props.fmt ? props.fmt(props.value) : props.value));
		}

		function SettingsPage() {
			const st = useStore();
			const previewReg = React.useRef({});
			const previewCtl = React.useMemo(() => makeLitController(previewReg.current), []);
			const [demoText, setDemoText] = React.useState(DEMO);
			const [playing, setPlaying] = React.useState(false);
			const aliveRef = React.useRef(true);
			React.useEffect(() => () => { aliveRef.current = false; }, []);

			const keys = keysOf(st);
			const box = layoutBox(keys);
			const btn = (active) => "tt-btn" + (active ? " tt-sel" : "");

			function runDemo() {
				if (playing) return;
				setPlaying(true);
				aliveRef.current = true;
				previewCtl.clear();
				playText(demoText || DEMO, st.cps, st, previewCtl.set, () => aliveRef.current)
					.then(() => { setPlaying(false); previewCtl.clear(); });
			}
			function toggleZone(z) {
				const zones = Object.assign({}, st.zones);
				zones[z] = !zones[z];
				setState({ zones });
			}
			function applyPreset(name) {
				const p = PRESETS[name];
				setState({ zones: Object.assign({}, p.zones), slim: p.slim });
			}
			function resetAll() {
				setState(Object.assign({}, DEFAULTS));
			}
			function toggleAllTools() {
				const all = !st.allTools;
				setState({ allTools: all });
				syncMode({ all: all });
			}
			function toggleSplitLines() {
				const on = !st.splitLines;
				setState({ splitLines: on });
				syncMode({ splitLines: on });
			}

			const zoneRow = React.createElement("div", { className: "tt-row" },
				React.createElement("span", { className: "tt-label" }, "分区"),
				["fn", "main", "nav", "pad"].map((z) => React.createElement("label", {
					key: z, className: "tt-check",
				},
					React.createElement("input", {
						type: "checkbox", checked: !!st.zones[z], onChange: () => toggleZone(z),
					}),
					ZONE_LABELS[z])));

			const presetRow = React.createElement("div", { className: "tt-row" },
				React.createElement("span", { className: "tt-label" }, "预设"),
				Object.keys(PRESETS).map((name) => React.createElement("button", {
					key: name, className: btn(false), onClick: () => applyPreset(name),
				}, PRESETS[name].label)));

			return React.createElement("div", { className: "tt-page" },
				React.createElement("p", { className: "tt-desc" },
					"LLM 每次执行终端命令时，在界面角落浮现一块迷你键盘并把命令逐字符敲出来。下面是实时预览与自定义。"),

				// ── 预览 ────────────────────────────────────────────
				React.createElement("div", { className: "tt-preview" },
					React.createElement("div", { className: "tt-preview-head" },
						React.createElement("span", { className: "tt-preview-title" }, "预览"),
						React.createElement("span", { className: "tt-num" },
							keys.length + " 键 · " + (box.span / 4) + "u 宽 · " + box.rows + " 行")),
					React.createElement("div", {
						className: "tt-card tt-preview-card",
						style: Object.assign(cardStyle(st, "min(" + kbWidthPx(st, box) + "px,100%)"), { opacity: clampOpacity(st.opacity) }),
					},
						st.showCmd ? React.createElement("div", {
							className: "tt-cmd", style: { fontSize: (st.cmdSize || 12) + "px" },
						}, React.createElement("b", null, "\u2328 LLM"), " ", demoText.length > 96 ? "\u2026" + demoText.slice(-96) : demoText) : null,
						React.createElement(KeyboardGrid, { opt: st, reg: previewReg, className: "tt-kb-preview" })),
					React.createElement("div", { className: "tt-row" },
						React.createElement("span", { className: "tt-label" }, "试打"),
						React.createElement("input", {
							className: "tt-input", type: "text", value: demoText,
							onChange: (e) => setDemoText(e.target.value),
						}),
						React.createElement("button", { className: "tt-btn" + (playing ? " tt-sel" : ""), onClick: runDemo },
							playing ? "播放中…" : "▶ 播放"))),

				// ── 分区 ────────────────────────────────────────────
				zoneRow,
				presetRow,
				React.createElement("div", { className: "tt-row" },
					React.createElement("span", { className: "tt-label" }, "主键区精简"),
					React.createElement("button", {
						className: btn(!!st.slim), onClick: () => setState({ slim: !st.slim }),
					}, st.slim ? "已精简（去掉 Win/Fn/Caps）" : "完整主键区")),

				// ── 外观 ────────────────────────────────────────────
				React.createElement("div", { className: "tt-group" }, "外观"),
				React.createElement(Slider, {
					label: "不透明度", min: 10, max: 100, step: 5,
					value: Math.round(clampOpacity(st.opacity) * 100),
					onChange: (v) => setState({ opacity: v / 100 }), fmt: (v) => v + "%",
				}),
				React.createElement(Slider, {
					label: "键盘宽度", min: 0, max: 1400, step: 1, value: st.width,
					onChange: (v) => setState({ width: v }),
					fmt: (v) => (v === 0 ? "自动" : v + "px"),
				}),
				React.createElement(Slider, {
					label: "键帽高度", min: 8, max: 40, step: 1, value: st.keyH,
					onChange: (v) => setState({ keyH: v }), fmt: (v) => v + "px",
				}),
				React.createElement(Slider, {
					label: "键帽字号", min: 0, max: 18, step: 1, value: st.fontSize,
					onChange: (v) => setState({ fontSize: v }), fmt: (v) => v + "px",
				}),
				React.createElement(Slider, {
					label: "键帽圆角", min: 0, max: 12, step: 1, value: st.radius,
					onChange: (v) => setState({ radius: v }), fmt: (v) => v + "px",
				}),
				React.createElement(Slider, {
					label: "键距", min: 0, max: 8, step: 1, value: st.gap,
					onChange: (v) => setState({ gap: v }), fmt: (v) => v + "px",
				}),
				React.createElement("div", { className: "tt-row" },
					React.createElement("span", { className: "tt-label" }, "键帽文字"),
					React.createElement("label", { className: "tt-check" },
						React.createElement("input", {
							type: "checkbox", checked: !!st.labels, onChange: () => setState({ labels: !st.labels }),
						}), "显示"),
					React.createElement("span", { className: "tt-label" }, "淡彩彩虹"),
					React.createElement("label", { className: "tt-check" },
						React.createElement("input", {
							type: "checkbox", checked: !!st.rainbow, onChange: () => setState({ rainbow: !st.rainbow }),
						}), "按列渐变")),
				React.createElement("div", { className: "tt-row" },
					React.createElement("span", { className: "tt-label" }, "高亮配色"),
					React.createElement("input", {
						type: "color", className: "tt-color", value: st.litFrom,
						onChange: (e) => setState({ litFrom: e.target.value }),
					}),
					React.createElement("input", {
						type: "color", className: "tt-color", value: st.litTo,
						onChange: (e) => setState({ litTo: e.target.value }),
					}),
					React.createElement("span", { className: "tt-num" }, st.litFrom + " → " + st.litTo)),
				React.createElement("div", { className: "tt-row" },
					React.createElement("span", { className: "tt-label" }, "键帽主体色"),
					React.createElement("label", { className: "tt-check" },
						React.createElement("input", {
							type: "checkbox", checked: !!st.bodyCustom,
							onChange: () => setState({ bodyCustom: !st.bodyCustom }),
						}), "自定义"),
					React.createElement("input", {
						type: "color", className: "tt-color", value: st.bodyFrom, disabled: !st.bodyCustom,
						onChange: (e) => setState({ bodyFrom: e.target.value }),
					}),
					React.createElement("input", {
						type: "color", className: "tt-color", value: st.bodyTo, disabled: !st.bodyCustom,
						onChange: (e) => setState({ bodyTo: e.target.value }),
					}),
					React.createElement("span", { className: "tt-desc" },
						st.bodyCustom ? "两色渐变；盖过淡彩彩虹，字色按明暗自动配" : "未开启：淡彩彩虹 / 主题键帽色")),
				React.createElement("div", { className: "tt-row" },
					React.createElement("span", { className: "tt-label" }, "键盘底板"),
					React.createElement("label", { className: "tt-check" },
						React.createElement("input", {
							type: "checkbox", checked: !!st.caseCustom,
							onChange: () => setState({ caseCustom: !st.caseCustom }),
						}), "自定义"),
					React.createElement("input", {
						type: "color", className: "tt-color", value: st.caseColor, disabled: !st.caseCustom,
						onChange: (e) => setState({ caseColor: e.target.value }),
					}),
					React.createElement("span", { className: "tt-desc" }, "卡片背景色；未开启跟随主题")),

				// ── 动画 ────────────────────────────────────────────
				React.createElement("div", { className: "tt-group" }, "动画"),
				React.createElement(Slider, {
					label: "打字速度", min: 5, max: 200, step: 1, value: st.cps,
					onChange: (v) => setState({ cps: v }), fmt: (v) => v + " 字/秒",
				}),
				React.createElement(Slider, {
					label: "键高亮时长", min: 20, max: 400, step: 10, value: st.litHold,
					onChange: (v) => setState({ litHold: v }), fmt: (v) => v + "ms",
				}),
				React.createElement(Slider, {
					label: "浮现停留", min: 300, max: 6000, step: 100, value: st.hold,
					onChange: (v) => setState({ hold: v }), fmt: (v) => (v / 1000).toFixed(1) + "s",
				}),
				React.createElement(Slider, {
					label: "淡入淡出", min: 0, max: 800, step: 20, value: st.fade,
					onChange: (v) => setState({ fade: v }), fmt: (v) => v + "ms",
				}),

				// ── 命令条 / 位置 ───────────────────────────────────
				React.createElement("div", { className: "tt-group" }, "命令条与位置"),
				React.createElement("div", { className: "tt-row" },
					React.createElement("span", { className: "tt-label" }, "命令条"),
					React.createElement("label", { className: "tt-check" },
						React.createElement("input", {
							type: "checkbox", checked: !!st.showCmd, onChange: () => setState({ showCmd: !st.showCmd }),
						}), "显示命令原文")),
				React.createElement(Slider, {
					label: "命令条字号", min: 9, max: 20, step: 1, value: st.cmdSize,
					onChange: (v) => setState({ cmdSize: v }), fmt: (v) => v + "px",
				}),
				React.createElement("div", { className: "tt-row" },
					React.createElement("span", { className: "tt-label" }, "浮现位置"),
					[["br", "右下"], ["bl", "左下"], ["tr", "右上"], ["tl", "左上"], ["custom", "自定义坐标"]].map((c) =>
						React.createElement("button", {
							key: c[0], className: btn(st.corner === c[0]), onClick: () => setState({ corner: c[0] }),
						}, c[1]))),
				st.corner === "custom" ? React.createElement(Slider, {
					label: "水平位置", min: 0, max: 96, step: 1, value: st.posX,
					onChange: (v) => setState({ posX: v }), fmt: (v) => v + "% （距左）",
				}) : null,
				st.corner === "custom" ? React.createElement(Slider, {
					label: "垂直位置", min: 0, max: 96, step: 1, value: st.posY,
					onChange: (v) => setState({ posY: v }), fmt: (v) => v + "% （距上）",
				}) : null,
				React.createElement(Slider, {
					label: "边距", min: 0, max: 120, step: 2, value: st.margin,
					onChange: (v) => setState({ margin: v }), fmt: (v) => v + "px",
				}),

				// ── 多命令：单键盘顺序 / 多键盘随机 ─────────────────
				React.createElement("div", { className: "tt-group" }, "多命令"),
				React.createElement("div", { className: "tt-row" },
					React.createElement("span", { className: "tt-label" }, "播放方式"),
					React.createElement("button", {
						className: btn(st.multi), onClick: () => setState({ multi: !st.multi }),
					}, st.multi ? "多键盘 · 随机位置" : "单键盘 · 顺序播放"),
					React.createElement("span", { className: "tt-desc" },
						st.multi ? "忽略上面的浮现位置，自动随机落位" : "位置按上面的浮现位置")),
				st.multi ? React.createElement(Slider, {
					label: "同时最多", min: 1, max: 8, step: 1, value: st.multiMax,
					onChange: (v) => setState({ multiMax: v }), fmt: (v) => v + " 块",
				}) : null,
				React.createElement("p", { className: "tt-desc" },
					"单键盘：一条命令打完再打下一条，位置固定（旧行为）。多键盘：每条命令各占一块键盘，" +
					"在视口里随机落位、尽量互不重叠，同时开打——命令密集时能一眼看出并发了几条。"),

				// ── 命令来源 / 积压保护 ─────────────────────────────
				React.createElement("div", { className: "tt-group" }, "命令来源"),
				React.createElement("div", { className: "tt-row" },
					React.createElement("span", { className: "tt-label" }, "播什么"),
					React.createElement("button", {
						className: btn(!!st.allTools), onClick: toggleAllTools,
					}, st.allTools ? "全部工具调用" : "仅命令类"),
					React.createElement("span", { className: "tt-desc" },
						st.allTools ? "读写文件、搜索…凡是它发的都敲" : "只敲终端命令与读取类")),
				React.createElement("div", { className: "tt-row" },
					React.createElement("span", { className: "tt-label" }, "多行命令"),
					React.createElement("button", {
						className: btn(!!st.splitLines), onClick: toggleSplitLines,
					}, st.splitLines ? "拆开：每行一块键盘" : "整条：一条一块键盘"),
					React.createElement("span", { className: "tt-desc" },
						st.splitLines ? "一条调用里的 N 行会同时开 N 块" : "一条工具调用只占一块键盘")),
				st.splitLines ? React.createElement(Slider, {
					label: "最多拆几条", min: 1, max: 12, step: 1, value: st.splitMax,
					onChange: (v) => { setState({ splitMax: v }); syncMode({ splitMax: v }); },
					fmt: (v) => v + " 条",
				}) : null,
				React.createElement("div", { className: "tt-row" },
					React.createElement("span", { className: "tt-label" }, "跳过过时"),
					React.createElement("label", { className: "tt-check" },
						React.createElement("input", {
							type: "checkbox", checked: !!st.skipStale,
							onChange: () => setState({ skipStale: !st.skipStale }),
						}), "积压太久的不补播")),
				st.skipStale ? React.createElement(Slider, {
					label: "过时阈值", min: 1000, max: 60000, step: 1000, value: st.staleMs,
					onChange: (v) => setState({ staleMs: v }), fmt: (v) => (v / 1000).toFixed(0) + " 秒",
				}) : null,

				// ── 总开关 / 重置 ───────────────────────────────────
				React.createElement("div", { className: "tt-group" }, "其它"),
				React.createElement("div", { className: "tt-row" },
					React.createElement("span", { className: "tt-label" }, "启用"),
					React.createElement("button", {
						className: btn(!!st.enabled), onClick: () => setState({ enabled: !st.enabled }),
					}, st.enabled ? "已启用" : "已禁用"),
					React.createElement("button", { className: "tt-btn", onClick: resetAll }, "恢复默认"))
			);
		}

		// ================================================================== 样式
		const CSS =
			// .tt-layer 只管定位与整体不透明度（opacity 由设置页的"不透明度"内联给）；
			// 浮现/淡出的动效挪到内层 .tt-card，这样"半透明"与"淡入淡出"互不打架
			".tt-layer{position:fixed;z-index:60;pointer-events:none}" +
			".tt-card{background:var(--tt-case,var(--dsw-alias-bg-layer-1,#fff));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));" +
			"border-radius:12px;padding:9px 11px;box-shadow:0 12px 34px rgba(0,0,0,.22);" +
			"display:flex;flex-direction:column;gap:7px;box-sizing:border-box;max-width:min(84vw,98vw);" +
			"opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease}" +
			".tt-layer.on .tt-card{opacity:1;transform:none}" +
			// 命令条宽度跟随键盘（flex stretch），过长自动换行，超过 5 行才裁掉
			".tt-cmd{font:12px/1.5 ui-monospace,Consolas,'Cascadia Mono',monospace;color:var(--dsw-alias-label-primary,#333);" +
			"min-width:0;white-space:pre-wrap;word-break:break-all;overflow:hidden;max-height:7.5em}" +
			".tt-cmd b{color:#4a9eff;font-weight:600}" +
			".tt-kb{display:grid;grid-auto-rows:auto}" +
			".tt-key{display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:3px;" +
			"background:var(--tt-kbg,var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14)));line-height:1;" +
			"color:var(--tt-ktext,var(--dsw-alias-label-secondary,rgba(128,128,128,.85)));" +
			"transition:background .06s linear,color .06s linear}" +
			".tt-key.lit{background:linear-gradient(160deg,var(--tt-lit-from,#7FB8FF),var(--tt-lit-to,#6FE6DE));color:#fff;font-weight:600}" +
			".tt-page{display:flex;flex-direction:column;gap:10px;padding:4px 2px 10px;font-size:13px;" +
			"color:var(--dsw-alias-label-primary,inherit)}" +
			".tt-desc{opacity:.75;margin:0}" +
			".tt-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
			".tt-label{min-width:84px;opacity:.85;flex:0 0 auto}" +
			".tt-num{min-width:96px;text-align:right;font-variant-numeric:tabular-nums;opacity:.8;font-size:12px}" +
			".tt-step{width:22px;height:22px;line-height:1;padding:0;flex:0 0 auto;cursor:pointer;font-size:13px;" +
			"border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:6px;background:transparent;color:inherit;" +
			"font-family:inherit}" +
			".tt-step:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.15))}" +
			".tt-btn{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:transparent;color:inherit;" +
			"border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;font-family:inherit}" +
			".tt-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.15))}" +
			".tt-sel{border-color:#4a9eff;background:rgba(74,158,255,.18)}" +
			".tt-group{margin-top:4px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25));" +
			"font-weight:600;opacity:.9}" +
			".tt-check{display:inline-flex;align-items:center;gap:5px;cursor:pointer;opacity:.9}" +
			".tt-check input{accent-color:#5b8def;cursor:pointer}" +
			".tt-input{flex:1 1 240px;min-width:160px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));" +
			"background:transparent;color:inherit;border-radius:6px;padding:3px 8px;font-size:12px;" +
			"font-family:ui-monospace,Consolas,monospace}" +
			".tt-color{width:34px;height:22px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));" +
			"border-radius:5px;background:transparent;padding:0;cursor:pointer}" +
			".tt-preview{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:10px;min-width:0;" +
			"border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));" +
			"background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.07))}" +
			".tt-preview-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}" +
			".tt-preview-title{font-weight:600;opacity:.9}" +
			".tt-preview-card{box-shadow:none;display:block;width:100%;max-width:100%;box-sizing:border-box;overflow:hidden;" +
			"opacity:1;transform:none}" +
			".tt-kb-preview{pointer-events:none}";

		function ensureStyle() {
			if (document.querySelector("style[data-diy-terminal-typing]")) return;
			const tag = document.createElement("style");
			tag.setAttribute("data-diy-terminal-typing", "1");
			tag.textContent = CSS;
			document.head.append(tag);
		}

		// ================================================================== 挂载
		function apply(ctx) {
			ensureStyle();
			ctx.interval(() => poll(), 700);
			syncMode();   // 把"播什么 / 拆不拆行"告诉宿主（宿主没就绪就静默失败）

			const slots = ctx.get("slots");
			if (slots === undefined) return;

			slots.inject("shell.overlay", () => slots.register(
				{ name: "shell.overlay", id: "terminal-typing-overlay", order: 60 },
				TypeOverlay,
			));

			slots.inject("settings.section", () => slots.register(
				{ name: "settings.section", id: "terminal-typing", order: 40, label: "终端打字" },
				SettingsPage,
			));
		}

		exports.apply = apply;
		exports.inject = ["timer"];
		exports.__internals = {
			buildLayout: buildLayout, keysOf: keysOf, DEFAULTS: DEFAULTS, PRESETS: PRESETS,
			pickRandomPos: pickRandomPos, fixedPos: fixedPos, CHAR2KEY: CHAR2KEY,
			pending: pending, isStale: isStale, takeNext: takeNext, syncMode: syncMode,
			capPending: capPending, PENDING_MAX: PENDING_MAX,
			buildKeyStyles: buildKeyStyles, KeyCap: KeyCap, TypeLane: TypeLane,
			makeLitController: makeLitController, playText: playText,
			modePayload: modePayload, clampOpacity: clampOpacity,
			idleColor: idleColor, bodyGradient: bodyGradient, readableInk: readableInk,
			hexLum: hexLum, isHex: isHex, caseColorOf: caseColorOf, cardStyle: cardStyle, CSS: CSS,
		};
		return module.exports;
	},
});
