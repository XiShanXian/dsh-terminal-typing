# dsh-terminal-typing

> 让 AI 在 DSH 里"敲键盘"给你看：界面角落浮现一块 99 键迷你键盘，LLM 每发起一次工具调用，命令就被逐字符敲出来，对应键位依次亮起。

它把一个纯文本的事件流变成可视化的输入过程——你能直观看到模型正在读哪个文件、跑什么命令，而不是等一个旋转的加载图标。

## 特性

- **99 键迷你键盘**：与真实键盘布局一致（F 区 / 主键区 / 方向导航 / 小键盘），键帽按字符逐个高亮，带 Shift 组合判定
- **一条命令一块键盘**，或多块键盘在视口内随机落位、同时开打
- **默认全播**：读文件、搜索、跑命令，所有工具调用都敲；可切成"仅命令类"
- **多行命令可按行拆开**：一条调用里写了 5 行 → 5 块键盘同屏开打，最多 6 块
- **命令条**：键盘上方滚动显示当前命令原文
- **高度可调**：分区、键高、字号、圆角、键距、浮层不透明度、彩虹或自定义主体色/底板色/高亮色
- **不阻塞主流程**：面板本身 `pointer-events: none`，永远不会挡住你的点击
- **不追赶过期命令**：排队超过 8 秒的事件直接丢弃，不会在你切回来时把几十秒前的命令重播一遍

## 安装

插件分宿主（`lib/index.js`）和客户端（`lib/client.js`）两半，包名 `dsh-diy-terminal-typing`。

1. 把本仓库放到任意目录。

2. 在 profile 的 `node_modules` 下建联接：

   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:DSH_HOME\profiles\<profile>\node_modules\dsh-diy-terminal-typing" `
     -Target "<你的目录>\dsh-terminal-typing"
   ```

3. 在 `cordis.patch.yml` 末尾加：

   ```yaml
   - insert:
       - id: terminal-typing
         name: 'dsh-diy-terminal-typing'
   ```

4. 重启 DSH。随便让模型跑个命令，右下角就会浮出键盘。

> 修改插件代码后需要重启（或在「设置 → 插件」里关掉再打开）；但**设置页里切换的运行时选项即时生效**，不需要重启。

## 配置

写在 patch 条目的 `config:` 段，全部可选：

```yaml
- insert:
    - id: terminal-typing
      name: 'dsh-diy-terminal-typing'
      config:
        enabled: true        # 总开关
        cps: 40              # 打字速度（字符/秒）；0 = 由显示端决定
        others: true         # true=所有工具调用都播；false=只播 tools 列表里的
        maxLen: 400          # 单条命令最长字符数，超出截断
        splitLines: false    # 多行命令是否拆成多块键盘
        splitMax: 6          # 单次最多拆几条
        tools:               # 视为"终端命令"的工具名
          - pwsh
          - bash
          - read
          - grep
          - "mcp__filesystem__read*"   # 结尾 * 是前缀通配
```

## 设置页

「设置 → 终端打字」里可以调所有外观与行为，改动存到 `localStorage`（键名 `dsh-diy-terminal-typing`），刷新后保留：

- **分区**：F 区 / 主键区 / 方向导航 / 小键盘，可单独开关；"主键区精简"会去掉 Win / Fn / Caps
- **外观**：宽度、键高、字号、圆角、键距、是否显示键帽文字、不透明度
- **配色**：彩虹渐变，或自定义键盘主体渐变色、底板色、高亮色（高亮色只接受 `#RGB` / `#RRGGBB`，非法值自动回退）
- **动画**：打字速度、高亮停留、整体停留、淡入淡出时长
- **命令条**：开关与字号
- **位置**：四角之一，或自定义百分比坐标
- **多键盘**：随机落位同时开打，最多 4 块
- **积压保护**：跳过超过 8 秒的陈旧事件

设置页还带一块**实时预览**和"试打"按钮，不用等模型真跑命令就能看效果。

## 工作原理

```
LLM 调用工具
   ↓
宿主 lib/index.js：ctx.on('tools/execute') 取命令文本 → 入内存队列（最多 200 条）
   ↓
客户端 lib/client.js：每 700ms GET /__diy/terminal-typing/events?since=<游标>
   ↓
浮层把新事件排进 pending 队列 → 逐字符触发行内键盘 → 结束后淡出
```

- 宿主侧是 **fire-and-forget**：立即 `return next()`，只做内存入队，绝不阻塞工具派发。
- 命令文本来源：终端类工具取 `args.command`；读取类（`read` / `grep` / `glob`）没有 `command` 字段，用 `file_path` / `path` / `pattern` 拼成一行。
- 端点全部同源相对路径，不跨域、不发外部请求。
- 游标（`lastSeq`）在每次成功取数后推进；首次取数只对齐游标、不回放历史，刷新页面不会重播旧命令。

## 开发

```bash
npm test    # 依次跑 tests/test_plugin.mjs（宿主）与 tests/test_client.mjs（客户端）
```

`test_client.mjs` 用一个极简的 React 替身把 bundle 加载进 Node，校验布局、键位映射、队列与颜色工具等纯逻辑，不启动真实 DOM。

## 已知限制

- **组件级逻辑未被测试覆盖**：现有测试用的是替身 React，`useState` 返回固定值，所以渲染循环、`onDone` 收敛、`useLayoutEffect` 定位这些路径没有自动化覆盖。
- **卸载清理不彻底**：`playText` 的熄灯定时器、`SingleOverlay` 的高亮控制器在组件卸载时没有被显式取消（当前靠整体切换掩盖了问题）。
- **窗口缩放不重定位**：多键盘位置在挂载时算一次，之后 resize 不会重算，窗口变小时卡片可能出界。
- **远程时钟偏差**：判断"事件是否陈旧"用的是浏览器 `Date.now()` 与宿主写入的 `at` 比较，`dsh web` 跨机器部署且时钟不同步时会误判。
- **端点无鉴权**：`/__diy/terminal-typing/events` 返回最近 200 条命令原文，同源可读。桌面端无碍；如果以 `dsh web` 形式监听公网，请自行确认有外层鉴权。
- **emoji 截断**：超长命令按 `maxLen` 截断时可能切开代理对，末尾显示半个字符。

## 许可证

[MIT](LICENSE) © 2026 XiShanXian
