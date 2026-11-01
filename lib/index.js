// dsh-diy-terminal-typing 宿主侧
//
// 作用：监听工具派发（tools/execute），把 LLM 发出的终端命令（以及 read / grep / glob
// 这类"读取命令"）变成一个"打字事件"：写进本插件的事件队列，浏览器侧（lib/client.js）
// 轮询 GET /__diy/terminal-typing/events?since=N 拿到后在 DSH 界面浮层里逐字敲出来。
//
// 设计要点：
//   - fire-and-forget：立即 return next()，只做内存入队，绝不阻塞工具派发。
//   - waterfall 必须透传 next()，否则工具派发链会断。
//   - global:true 绕过 ToolRuntime 所在 isolate 的 scope 过滤（与 soundfx 同理）。
//
// 可选配置（cordis.patch.yml 的 config 段）：
//   enabled   总开关（默认 true）
//   cps       打字速度 字符/秒，0 = 由显示端自己决定
//   tools     视为"命令"的工具名列表。终端类取 args.command 原文；读取类（read/grep/glob…）
//             没有 command 字段，按 file_path / path / pattern 拼成一行。支持结尾 * 前缀通配，
//             例如 mcp__filesystem__read* 可覆盖 read_text_file / read_media_file 等。
//   others    非命令类工具是否也打出来（默认 false）
//   maxLen    单条最长字符数（默认 400，超出截断）
//   splitLines 多行命令是否拆成多条打字事件（默认 false；开了之后一条调用能点亮多块键盘）
//   splitMax  单次最多拆几条（默认 6）

const inject = ['webServer']

const DEFAULTS = {
  enabled: true,
  cps: 0,
  tools: [
    // 终端类：args.command 就是命令原文
    'pwsh', 'shell', 'bash', 'sh', 'cmd', 'terminal', 'run_command', 'execute_command',
    // 读取类：按 file_path / path / pattern 拼成一行命令
    'read', 'grep', 'glob', 'list_dir', 'mcp__filesystem__read*', 'mcp__filesystem__list*',
  ],
  others: true,       // true = LLM 发起的**所有**工具调用都算"命令"（读写文件、搜索…全敲出来）；
                      // false = 只播 tools 列表里的。客户端设置页的开关可运行时覆盖这一项。
  maxLen: 400,
  // 多行命令拆开：一条工具调用里的 N 行 → N 条打字事件（客户端就能同时点亮 N 块键盘）。
  // 默认关（保持"一次调用一块键盘"的语义）；只按换行拆、不动分号，误拆风险最低。
  splitLines: false,
  splitMax: 6,        // 单次最多拆出几条，免得一屏刷不完
}

// 工具名匹配：精确相等；列表项以 * 结尾时按前缀匹配（如 mcp__filesystem__read*）
function isWantedTool(name, list) {
  for (const t of (list || [])) {
    if (t === name) return true
    if (t.length > 1 && t.endsWith('*') && name.startsWith(t.slice(0, -1))) return true
  }
  return false
}

// 没有 command 字段的工具（读取类）：用工具名 + 关键参数拼成一行"命令"
function describeTool(name, args) {
  const str = (v) => (v === undefined || v === null ? '' : String(v))
  const out = [name]
  const pattern = str(args.pattern)
  const target = str(args.file_path) || str(args.path) || str(args.dir)
    || str(args.directory) || str(args.url) || str(args.query)
    || str(args.job_id) || str(args.id)
  if (pattern) out.push(JSON.stringify(pattern))
  if (target) out.push(target)
  if (args.include) out.push('--include=' + str(args.include))
  if (args.offset || args.limit) out.push('[' + (args.offset || 0) + (args.limit ? ' +' + args.limit : '') + ']')
  return out.join(' ')
}

function pickText(exec, cfg) {
  const name = exec && exec.name ? String(exec.name) : ''
  if (!isWantedTool(name, cfg.tools) && !cfg.others) return ''
  const args = exec ? exec.arguments : undefined
  let text = ''
  if (typeof args === 'string') {
    text = args
  } else if (args && typeof args === 'object') {
    text = String(args.command ?? args.cmd ?? args.script ?? args.code ?? '')
    if (!text) text = describeTool(name, args)   // 读取类等：没有 command 字段
  }
  if (!text) text = name
  text = text.replace(/\r/g, '')
  if (text.length > cfg.maxLen) text = text.slice(0, cfg.maxLen) + ' …'
  return text.trim()
}

// 把一条命令文本按换行拆成多条（用于"一条调用点亮多块键盘"）。
// 只按 \n 拆、丢掉空行；最多 limit 条，超出的行并进最后一条并标注，免得一屏刷不完。
// 单行输入原样返回（数组里只有一条）。
function splitText(text, limit) {
  const lines = String(text).split('\n').map((s) => s.trim()).filter(Boolean)
  if (lines.length <= 1) return [String(text)]
  const max = Math.max(1, Number(limit) || 6)
  const head = lines.slice(0, max)
  if (lines.length > max) head[max - 1] += ' …(还有 ' + (lines.length - max) + ' 行)'
  return head
}

// 对外回报当前运行时模式（GET /events 与 POST /mode 共用）
function modeOf(cfg) {
  return { all: cfg.others, maxLen: cfg.maxLen, splitLines: cfg.splitLines, splitMax: cfg.splitMax }
}

function apply(ctx, config = {}) {
  const cfg = Object.assign({}, DEFAULTS, config || {})
  if (cfg.enabled === false) return

  // 打字事件队列（供浏览器侧轮询）
  const events = []
  let seq = 0
  const pushEvent = (text, cps) => {
    seq += 1
    events.push({ seq, type: 'type', text, cps, at: Date.now() })
    if (events.length > 200) events.splice(0, events.length - 200)
  }

  ctx.on('tools/execute', (exec, next) => {
    try {
      const text = pickText(exec, cfg)
      if (text) {
        // 拆行开关：一条调用的 N 行 → N 条事件（同一时刻入队，客户端一次轮询全拿到）
        const texts = cfg.splitLines ? splitText(text, cfg.splitMax) : [text]
        for (const one of texts) {
          pushEvent(one, cfg.cps || 0)
        }
      }
    } catch (e) { /* 只读字段，异常一律吞掉 */ }
    return next()
  }, { global: true })

  // 浏览器侧取事件：GET /__diy/terminal-typing/events?since=N
  // （必须 inject webServer：cordis 并发启动不保证 apply 时序，仅 ctx.get 可能拿到 undefined）
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return
  webServer.register({
    kind: 'exact',
    path: '/__diy/terminal-typing/events',
    handler: (req, res) => {
      try {
        const u = new URL(req.url, 'http://localhost')
        const since = Number(u.searchParams.get('since') || 0) || 0
        const out = []
        let last = since
        for (const ev of events) {
          if (ev.seq <= since) continue
          out.push(ev)
          last = ev.seq
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(JSON.stringify({ events: out, lastSeq: last, mode: modeOf(cfg) }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      }
    },
  })

  // 客户端设置页切「播什么」：POST /__diy/terminal-typing/mode  { all: true|false }
  // all=true → 所有工具调用都播；false → 只播 tools 列表里的。改的是运行时 cfg，无需重启。
  webServer.register({
    kind: 'exact',
    path: '/__diy/terminal-typing/mode',
    handler: (req, res) => {
      const send = (code, obj) => {
        try {
          res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify(obj))
        } catch (e) { /* 连接已断：忽略 */ }
      }
      if (req.method !== 'POST') { send(405, { error: 'use POST' }); return }
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
        if (raw.length > 4096) { raw = ''; try { req.destroy() } catch (e) { /* ignore */ } }
      })
      req.on('end', () => {
        try {
          const obj = raw ? JSON.parse(raw) : {}
          if (typeof obj.all === 'boolean') cfg.others = obj.all
          if (typeof obj.maxLen === 'number' && obj.maxLen > 0) cfg.maxLen = obj.maxLen
          if (typeof obj.splitLines === 'boolean') cfg.splitLines = obj.splitLines
          if (typeof obj.splitMax === 'number' && obj.splitMax > 0) cfg.splitMax = obj.splitMax
          send(200, { ok: true, mode: modeOf(cfg) })
        } catch (err) {
          send(400, { error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  })
}

export { apply, inject }
export { pickText, describeTool, isWantedTool, splitText, modeOf, DEFAULTS }
