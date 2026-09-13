# playwright 浏览器降级 SOP（lark-playwright server）

> **定位**：lark-all-mcp 工具调用失败或 server 未连接（未配 `LARK_APP_ID`、权限不足等）时，文档类飞书链接**自动**降级为本路径——用浏览器打开链接、复用用户登录态读正文，免建自建应用。正常情况下仍优先走 lark-all-mcp（API 快、结构化、带元数据）。

## 适用范围

| 链接形态 | 能否降级 | 说明 |
|---------|---------|------|
| `/docx/<token>` 新版文档 | ✅ | 主场景 |
| `/wiki/<token>`（节点是文档） | ✅ | 网页版自动解析并渲染实际文档，无需先换 obj_token |
| `/wiki/<token>`（节点是多维表格） | ❌ | 同 `/base/`，回到引导粘贴/配 APP_ID |
| `/base/<app_token>` 多维表格 | ❌ | 网页版虚拟滚动 + 懒加载，无法可靠全量读记录 |
| 普通网页链接 | 不属于本降级 | 直接用网页抓取能力 |

## 标准流程（五步）

### 1. 打开链接

`mcp__lark-playwright__browser_navigate` 打开原始链接（`/wiki/` 链接直接给原 URL，网页会自己跳到实际文档）。

### 2. 登录检测（仅首次需要）

满足任一信号即未登录：当前 URL 含 `passport` / `accounts` / `login`；或 snapshot 里出现"扫码登录 / 手机号登录"等表单。

- 告知用户："已在浏览器窗口打开文档，请扫码/登录一次（之后免登录）"
- `browser_wait_for`（time: 5）轮询，直到 URL 回到原文链接（整体不要超过约 2 分钟）
- 登录态保存在 playwright 专属持久 profile，跨会话保持，下次直接进第 3 步

### 3. 等待渲染

`browser_wait_for`（time: 2~3）让文档主体渲染完成。

### 4. 提取正文

- **短文档**：直接 `browser_snapshot`（结构化，保留标题层级、列表）
- **长文档**（懒加载/虚拟滚动，snapshot 只有局部）→ 分段采集：
  1. 页首先取一次正文，记为第 1 段：
     ```js
     () => document.body.innerText
     ```
  2. `browser_press_key`（key: `End`）滚动一屏并触发加载 → `browser_wait_for`（time: 1）→ 再取 `document.body.innerText` 存为下一段
  3. 重复直到连续两次取到的内容长度不再增长（已到底）
  4. Claude 将各段**拼接并去除重叠部分**合成全文（虚拟滚动会卸载顶部已渲染块，必须边滚边存，不能只取最后一次）
  5. 备选：`End` 键无效时改用 `browser_evaluate` 执行 `window.scrollTo(0, document.body.scrollHeight)` 滚动
- **标题**：`browser_evaluate` 取 `() => document.title`（飞书文档页标题即文档名）

### 5. 元数据局限

作者、创建时间等元数据网页端没有可靠获取途径 → 整理稿 `source` 写 `飞书文档（浏览器读取）：{标题} {链接}`，不要编造作者/时间。

## 工具速查（本降级实际用到的）

| 工具 | 用途 |
|------|------|
| `browser_navigate` | 打开链接 |
| `browser_snapshot` | 无障碍树快照（短文档结构化提取首选；也用于登录/无权限页判断） |
| `browser_evaluate` | 执行 JS：取 `document.body.innerText` / `document.title`、滚动 |
| `browser_press_key` | 按 `End` 滚屏触发懒加载 |
| `browser_wait_for` | 等渲染 / 等登录跳回 |
| `browser_find` | 在快照里定位文本（快速判断是否登录页、无权限页） |
| `browser_tabs` | 多链接批量整理时管理标签页 |
| `browser_close` | 全部读完后收尾 |

## 错误处理

| 现象 | 处理 |
|------|------|
| 浏览器启动失败 / 未装 Chrome | 提示安装 Chrome；或在 `plugin.json` 的 `lark-playwright` args 里加 `"--browser", "msedge"` |
| profile 锁冲突（Windows） | 与宿主其他 playwright MCP 实例（如 content-producer 插件）同时持有浏览器会争用默认持久 profile → 关闭其他会话的浏览器窗口；或给 args 加 `"--user-data-dir", "<独立目录>"` |
| 登录超时（用户未扫码） | 放弃降级，回退到请用户粘贴关键内容，**不要卡死** |
| 打开后提示"无权限访问/申请权限" | 该文档对当前账号不可见 → 请用户确认链接分享权限后重试，或直接粘贴 |
| 取到的正文是目录/空壳 | 长文档未渲染完 → 回到第 4 步先分段滚动采集 |

## 红线

- 降级路径**只读**：不点击"分享 / 导出 / 编辑 / 评论 / 加入知识库"等任何按钮，不修改页面任何状态
- 只读用户给的链接本身，不要顺着页面里出现的其他文档链接继续爬
