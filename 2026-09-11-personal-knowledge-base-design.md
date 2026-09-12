# 知识库 Claude Code 插件 — 设计文档

- **日期**：2026-09-11
- **状态**：已定稿并实施（见 `mcp-server/`、`plugin/`）
- **模板参照**：`F:\workspace\plugins\lark-bitable-plugin`
- **⚠ 命名更新（2026-09-12 user 反馈，实施以此为准）**：
  - 环境变量前缀 `KB_*` → **`LIBRARY_*`**（如 `KB_ROOT` → `LIBRARY_ROOT`，默认 `~/library`）
  - 元数据目录 `.kb` → **`.library`**；sqlite 文件 `kb.sqlite` → **`library.sqlite`**
  - skill `kb-organize` → **`library-organize`**；`kb-query` → **`library`**
  - mcp-server 包名 → **`@jesonliu/library-mcp`**；MCP 工具 `mcp__library__{search,read,list,write,delete}`
  - 正文其余 `kb_*` / `KB_*` / `kb-` 字样均为历史草案写法

---

## 1. 目标与范围

构建一个 Claude Code 插件，让用户在飞书对话中通过自然语言完成两类工作：

- **整理入库**：丢一个飞书文件（云文档 / 多维表格 / Excel / Markdown），说"帮我整理一下" → Claude 读 → 检索历史 → 生成整理结果 → 飞书卡片确认 → 写入本地知识库
- **检索问答**：说"知识库里有没有关于 X 的笔记" → Claude 检索 → 整理答案 → 飞书卡片回复

**核心交付物**：
- 2 个 Skill（`kb-organize`、`kb-query`）
- 1 个独立 MCP server（`@xxx/kb-mcp`，Node.js + TypeScript，stdio 传输）
- 本地存储：`.md`（真相） + SQLite（含 FTS5 全文索引）

**MVP 不做**：双向同步、Embedding/向量库、OCR、网页剪藏、语音转写、CLI 工具、版本历史、多用户共享。

---

## 2. 核心场景

### 场景 A：飞书文件整理入库

```
用户在飞书：
  "帮我整理 [飞书文档]"        ↓
kb-organize Skill (Claude Code 内):
  ① lark-doc-mcp 读飞书文件
  ② kb_search 找历史类似（top 3-5）
  ③ Claude 总结分析（参考历史 + 当前内容）
  ④ 飞书卡片展示整理结果
  ⑤ 询问"确认写入知识库？"
  ⑥ 用户"确认" → kb_write 入库
  ⑦ 飞书回复"已收集整理 doc_xxx"
```

### 场景 B：知识库检索问答

```
用户在飞书：
  "知识库里有没有关于 RAG 的笔记？"        ↓
kb-query Skill:
  ① 解析查询意图
  ② kb_search(query, top_k=5) → 召回候选
  ③ kb_read(doc_id) 读候选原文
  ④ Claude 综合整理
  ⑤ 飞书卡片回复（含 doc_id 链接、要点、关联）
  ⑥ 询问"是否深入"（再读全文 / 查更多 / 按时间排）
```

---

## 3. 架构总览

```
飞书对话  ─→ lark-claudecode-bridge（已有）
                    ↓
        Claude Code（本地）
         ├── Skill: kb-organize / kb-query
         ├── MCP Client → kb-mcp（kb_search/read/list/write/delete）
         └── MCP Client → lark-doc-mcp / lark-bitable
                    │ stdio
        ┌───────────▼────────────┐
        │ kb-mcp (Node.js+TS)    │
        │  ├ 工具集 (5 个)        │
        │  └ SQLite FTS5 + .md  │
        └────────────┬───────────┘
                     ↓
        {KB_ROOT}/docs/*.md + .kb/kb.sqlite
```

---

## 4. 仓库目录结构

```
kb-plugin/
├── .claude-plugin/marketplace.json
├── README.md / LICENSE
├── package.json                 # private、type=module
│
├── plugin/                      # Claude Code 插件
│   ├── .claude-plugin/
│   │   └── plugin.json          # 含 mcpServers → kb-mcp
│   └── skills/
│       ├── kb-organize/
│       │   ├── SKILL.md
│       │   └── references/
│       │       ├── workflow.md
│       │       └── kb-mcp-tools.md
│       └── kb-query/
│           ├── SKILL.md
│           └── references/
│               ├── workflow.md
│               ├── kb-mcp-tools.md
│               └── query-patterns.md
│
├── mcp-server/                  # 独立 npm 包 @xxx/kb-mcp
│   ├── src/
│   │   ├── index.ts             # MCP + StdioServerTransport 入口
│   │   ├── config.ts            # env 加载 + 默认值
│   │   ├── storage.ts           # .md + sqlite 元数据读写
│   │   ├── search.ts            # FTS5 全文检索
│   │   ├── frontmatter.ts       # gray-matter 包装
│   │   ├── link-parser.ts       # [[doc_xxx]] 双链解析
│   │   ├── id.ts                # doc_id 生成
│   │   └── tools/
│   │       ├── search.ts        # mcp__kb__search
│   │       ├── read.ts          # mcp__kb__read
│   │       ├── list.ts          # mcp__kb__list
│   │       ├── write.ts         # mcp__kb__write (KB_ALLOW_WRITE)
│   │       └── delete.ts        # mcp__kb__delete (KB_ALLOW_DELETE)
│   ├── tests/                   # vitest 单测
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── package.json
│
└── scripts/
    ├── bump-version.mjs
    └── dev-link.mjs
```

**运行时数据目录（不在仓库内）**：
```
{KB_ROOT}/
├── docs/*.md                    # 笔记正文（真相）
└── .kb/kb.sqlite                # SQLite（含 docs + docs_fts + links）
```

---

## 5. MCP Server 工具集

| 工具 | 输入 | 输出 | 鉴权 |
|---|---|---|---|
| `kb_search` | `query: string`, `top_k?: number` | `[{id, title, snippet, score}]` | 永远可读 |
| `kb_read` | `doc_id: string` | `{id, title, content, frontmatter, links}` | 永远可读 |
| `kb_list` | `filter?: {type?, tags?, status?, limit?}` | `[{id, title, type, tags, updated_at}]` | 永远可读 |
| `kb_write` | `{type, title, content, tags?, source?, links?}` | `{doc_id}` | `KB_ALLOW_WRITE=true` |
| `kb_delete` | `doc_id: string`, `confirm: true` | `{ok: true}` | `KB_ALLOW_DELETE=true` |

**写鉴权机制**：启动期读 env 开关；关闭时工具不注册，调用返回明确错误。防误写。

---

## 6. 环境变量（全部走 env，无 config.toml）

| env | 默认 | 说明 |
|---|---|---|
| `KB_ROOT` | `~/kb` | 知识库根目录 |
| `KB_DOCS_SUBDIR` | `docs` | 笔记子目录 |
| `KB_METADATA_DIR` | `.kb` | 元数据子目录 |
| `KB_SQLITE_NAME` | `kb.sqlite` | sqlite 文件名 |
| `KB_ALLOW_WRITE` | `false` | 开启 kb_write |
| `KB_ALLOW_DELETE` | `false` | 开启 kb_delete |
| `KB_SEARCH_DEFAULT_TOPK` | `5` | kb_search 默认 top_k |
| `KB_LIST_DEFAULT_LIMIT` | `20` | kb_list 默认 limit |
| `KB_LOG_LEVEL` | `info` | debug / info / warn / error |
| `KB_FTS_TOKENIZE` | `unicode61` | FTS5 分词器 |
| `KB_ID_PREFIX` | `doc_` | doc_id 前缀 |

**plugin.json 中的 env 块**：
```json
{
  "mcpServers": {
    "kb": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/../mcp-server/dist/index.js"],
      "env": {
        "KB_ROOT": "${KB_ROOT:-}",
        "KB_DOCS_SUBDIR": "${KB_DOCS_SUBDIR:-docs}",
        "KB_METADATA_DIR": "${KB_METADATA_DIR:-.kb}",
        "KB_SQLITE_NAME": "${KB_SQLITE_NAME:-kb.sqlite}",
        "KB_ALLOW_WRITE": "${KB_ALLOW_WRITE:-false}",
        "KB_ALLOW_DELETE": "${KB_ALLOW_DELETE:-false}",
        "KB_SEARCH_DEFAULT_TOPK": "${KB_SEARCH_DEFAULT_TOPK:-5}",
        "KB_LIST_DEFAULT_LIMIT": "${KB_LIST_DEFAULT_LIMIT:-20}",
        "KB_LOG_LEVEL": "${KB_LOG_LEVEL:-info}",
        "KB_FTS_TOKENIZE": "${KB_FTS_TOKENIZE:-unicode61}",
        "KB_ID_PREFIX": "${KB_ID_PREFIX:-doc_}"
      }
    }
  }
}
```

**用户侧配置示例**：
```cmd
setx KB_ROOT "D:/workspaces/daily-work/kb"
setx KB_ALLOW_WRITE "true"
```

---

## 7. 存储格式

### .md Frontmatter
```yaml
---
id: doc_2026-09-11_001
type: summary                       # summary | archive
title: "客户 A 上周会议总结"
source:                             # 来源数组（JSON 化后存 sqlite）
  - kind: feishu_doc
    token: "doccnXXX"
    url: "https://feishu.cn/docs/..."
tags: ["会议", "客户A"]
status: active                      # active | draft | deleted
created_at: 2026-09-11T10:00:00Z
updated_at: 2026-09-11T10:00:00Z
links:
  - "[[doc_2026-09-10_005]]"
---
```

### 正文段落约定
```markdown
# {title}
## 📋 关键要点
- ...
## 📖 详细摘要
...
## 🔗 关联笔记
- [[doc_xxx]] 历史类似
---
*整理时间：...*
*来源：...*
```

### SQLite Schema
```sql
CREATE TABLE docs (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('summary','archive')),
  path        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  source      TEXT,           -- JSON array
  tags        TEXT,           -- JSON array
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK(status IN ('active','draft','deleted')),
  created_at  TIMESTAMP NOT NULL,
  updated_at  TIMESTAMP NOT NULL
);

CREATE VIRTUAL TABLE docs_fts USING fts5(
  title, content, tags,
  content='docs', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- 触发器：FTS5 ↔ docs 同步
CREATE TRIGGER docs_fts_ai AFTER INSERT ON docs BEGIN
  INSERT INTO docs_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, '', new.tags);
END;
CREATE TRIGGER docs_fts_ad AFTER DELETE ON docs BEGIN
  DELETE FROM docs_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER docs_fts_au AFTER UPDATE ON docs BEGIN
  UPDATE docs_fts SET title = new.title, tags = new.tags
  WHERE rowid = new.rowid;
END;

CREATE TABLE links (
  src_doc_id  TEXT NOT NULL,
  dst_doc_id  TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'related'
              CHECK(kind IN ('related','cites','supersedes')),
  created_at  TIMESTAMP NOT NULL,
  PRIMARY KEY (src_doc_id, dst_doc_id, kind),
  FOREIGN KEY (src_doc_id) REFERENCES docs(id) ON DELETE CASCADE,
  FOREIGN KEY (dst_doc_id) REFERENCES docs(id) ON DELETE CASCADE
);
CREATE INDEX idx_links_dst ON links(dst_doc_id);
```

---

## 8. Skill 工作流

### kb-organize（写入）

```
① 解析飞书文件链接（lark-bitable / lark-doc-mcp）
② 读文件内容
③ kb_search 找历史类似（top 3-5） → 注入 prompt
④ Claude 总结分析
   → 决定 mode = archive | summary
   → 生成 frontmatter + 正文
⑤ 飞书卡片显示摘要 + 询问"确认写入？"
⑥ 用户"确认" → kb_write({type, title, content, tags, source, links})
⑦ 飞书回复"已收集整理 doc_xxx"
```

### kb-query（读取）

```
① 解析查询意图
   → 关键词提取
   → 可选过滤（type / tags / status / 时间范围）
② kb_search(query, top_k=5)
   → 0 命中 → "知识库中暂无相关内容，是否新增？"
③ kb_read(doc_id) 读候选原文
④ Claude 综合整理
   → 整合多个笔记核心观点
   → 标注 doc_id 引用 / 关联
⑥ 飞书卡片回复（标题 + 摘要 + 要点 + doc_id 链接）
⑦ 询问"是否深入"（再读全文 / 查更多 / 按时间排序）
```

---

## 9. 安装使用

```bash
# 1. 配 env（启动 Claude Code 之前）
setx KB_ROOT "D:/workspaces/daily-work/kb"
setx KB_ALLOW_WRITE "true"

# 2. 装插件
/plugin marketplace add <kb-plugin git URL>
/plugin install kb-organize@kb-organize
/plugin install kb-query@kb-query

# 3. 首次使用（kb-mcp 自动 init）
# 在 Claude Code 里说："在 KB_ROOT 初始化知识库"

# 4. 飞书里日常使用
"帮我整理 [飞书文档]"
"知识库里有没有关于 RAG 的笔记？"
```

---

## 10. 测试策略

| 模块 | 测试要点 |
|---|---|
| `storage.ts` | .md 读写、原子 rename（.tmp + rename） |
| `search.ts` | FTS5 检索、中文分词、top_k 排序 |
| `frontmatter.ts` | YAML 解析、缺字段兜底 |
| `link-parser.ts` | `[[doc_xxx]]` 解析、别名 |
| `tools/search.ts` | 参数校验、返回格式 |
| `tools/write.ts` | 鉴权开关、原子写、触发器同步 |
| `tools/delete.ts` | 软删除、confirm 必传 |
| **集成** | 端到端：write → search 能搜到 → read 能读到 → delete |

测试框架：vitest（零网络，单测可独立跑）。

---

## 11. 错误处理

| 场景 | 处理 |
|---|---|
| `KB_ROOT` 不可写 | 启动报错并退出 |
| `KB_ALLOW_WRITE=false` 时调 kb_write | 工具返回"只读模式，需设 KB_ALLOW_WRITE=true 后重启" |
| sqlite 损坏 | 启动检测，备份损坏文件，提示运行 init 重建 |
| .md 写入失败 | `.md.tmp` + 原子 rename，避免半写 |
| FTS5 索引不同步 | 启动期 `INSERT INTO docs_fts(docs_fts) VALUES('rebuild')` |
| lark-doc-mcp 不可达 | Skill 返回"飞书侧读取失败，请检查 lark-doc-mcp 状态" |
| 用户在飞书拒绝确认 | 不写库，飞书回复"已取消" |

---

## 12. 实施分期

| 期 | 范围 | 估时 |
|---|---|---|
| **MVP** | 仓库骨架 + mcp-server 5 工具 + kb-organize + kb-query + FTS5 + 飞书完整闭环 | **1-2 周** |
| V1 | 高亮片段 / 过滤增强 / 错误码细化 | 1 周 |
| V2 | 图片 OCR / 网页剪藏（可选） | 视情况 |
| 未来 | 多用户 / 远书同步 | 视情况 |

---

## 13. 依赖清单（最终）

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "zod": "^3.25.76",
    "better-sqlite3": "^11.0.0",
    "gray-matter": "^4.0.3"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.7",
    "esbuild": "^0.28.2",
    "tsx": "^4.23.13",
    "@types/node": "^22.0.0"
  }
}
```

---

## 14. 决策日志（本次 brainstorming 全部决策）

| # | 维度 | 取值 |
| --- | --- | --- |
| 1 | 宿主 | 纯本地 |
| 2 | 内容范围 | 混合型（工作/学习/生活） |
| 3 | 同步方向 | 无（纯本地） |
| 4 | 形态 | Claude Code 插件（仿 lark-bitable-plugin） |
| 5 | Skill 数 | 2 个：kb-organize + kb-query |
| 6 | MCP 栈 | Node.js + TypeScript + esbuild |
| 7 | MCP 传输 | stdio |
| 8 | 配置 | 全部 env 变量，无 config.toml |
| 9 | 写鉴权 | KB_ALLOW_WRITE / KB_ALLOW_DELETE（默认 false） |
| 10 | 存储 | 本地 .md + SQLite |
| 11 | 检索 | SQLite FTS5 + unicode61 分词 |
| 12 | 不做 | 双向同步 / Embedding / 向量库 / OCR / 网页 / 语音 / CLI / 版本历史 |
| 13 | 写库粒度 | summary + archive 两种都支持 |
| 14 | 确认时机 | 飞书卡片 + 用户回复 |
| 15 | 采集入口 | 飞书对话（lark-doc-mcp / lark-bitable） |
| 16 | 文档 | 不写 env-config.md（env 清单在 plugin.json 里已含） |