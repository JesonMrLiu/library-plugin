# library-plugin — 个人知识库 Claude Code 插件

在飞书对话里完成两件事：

- **整理入库**：丢一个飞书文档/多维表格/长文本 → Claude 读取 → 检索历史关联 → 生成摘要笔记（要点 + 双链 + 标签）→ 卡片确认 → 写入本地知识库
- **检索问答**：「知识库里有没有关于 X 的笔记？」→ trigram 全文检索 → 综合多篇笔记给出带 doc_id 引用的回答

设计文档：[2026-09-11-personal-knowledge-base-design.md](./2026-09-11-personal-knowledge-base-design.md)（注意头部命名更新说明）

## 架构

```
飞书对话 → lark-claudecode-bridge → Claude Code
                                      ├── Skill: library-organize（整理入库）
                                      ├── Skill: library（检索问答）
                                      └── MCP → @jesonliu/library-mcp（stdio）
                                                └── .md 真相存储 + SQLite FTS5 索引

~/library/                 ← LIBRARY_ROOT（可配）
├── docs/doc_2026-09-12_001.md   # 笔记（真相，可手工编辑）
└── .library/library.sqlite      # 索引 + 元数据 + doc_id 计数 + links
```

- **trigram 分词**：中文子串召回好——查「检索增强」能召回《RAG 检索增强生成》；<3 字符查询自动 LIKE 兜底
- **默认只读**：`write` / `delete` 工具不注册，直到 env 显式开启（机制级保护，非提示词约束）
- **启动期自动 init**：首次启动自动建目录 / 建库 / 建索引，无需手动初始化命令

## 安装

```bash
# 1. 配 env（启动 Claude Code 之前）
setx LIBRARY_ROOT "D:/workspaces/kb"       # 缺省 ~/library
setx LIBRARY_ALLOW_WRITE "true"            # 需要整理入库时
setx LIBRARY_ALLOW_DELETE "true"           # 需要软删除时（还需 WRITE 同开）

# 2. 装插件（本地路径方式）
claude plugin add F:/workspace/plugins/library-plugin

# 3. 重启 Claude Code 会话（连上飞书桥接后即可在飞书里用）
```

## 使用

飞书对话示例：

```
场景 A（整理）：
  你：帮我整理 https://xxx.feishu.cn/docx/ABC123
  Claude：读文档 → 检索历史 → 卡片展示【标题/要点/标签/关联】→ 问"确认写入？"
  你：确认
  Claude：已收集整理 doc_2026-09-12_001

场景 B（检索）：
  你：知识库里有没有关于 trigram 的笔记？
  Claude：search 召回 → read 相关篇 → 卡片回答（要点 + doc_id 引用）→ 问是否深入
```

本地对话同样可用（不必经过飞书）。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `LIBRARY_ROOT` | `~/library` | 知识库根目录（建议本地盘，勿用网络盘） |
| `LIBRARY_DOCS_SUBDIR` | `docs` | 笔记子目录 |
| `LIBRARY_METADATA_DIR` | `.library` | 元数据目录 |
| `LIBRARY_SQLITE_NAME` | `library.sqlite` | sqlite 文件名 |
| `LIBRARY_ALLOW_WRITE` | `false` | 开启后 `write` 工具才注册 |
| `LIBRARY_ALLOW_DELETE` | `false` | 开启后 `delete` 工具才注册（需 WRITE 同开） |
| `LIBRARY_SEARCH_DEFAULT_TOPK` | `5` | search 默认返回条数 |
| `LIBRARY_LIST_DEFAULT_LIMIT` | `20` | list 默认返回条数 |
| `LIBRARY_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`（stderr） |
| `LIBRARY_ID_PREFIX` | `doc_` | doc_id 前缀 |

## MCP 工具（`mcp__library__*`）

| 工具 | 注册条件 | 用途 |
|------|---------|------|
| `search` | 永远 | 全文检索（query / top_k / type / tags） |
| `read` | 永远 | 按 doc_id 读全文（frontmatter + 正文 + 合并双链） |
| `list` | 永远 | 浏览文档列表（type / tags / status / limit） |
| `write` | `ALLOW_WRITE=true` | 写入新文档（type / title / content / tags / source / links） |
| `delete` | `ALLOW_WRITE` + `ALLOW_DELETE` | 软删除（必须传 `confirm: true`；.md 保留可恢复） |

## 开发

```bash
cd mcp-server
npm install
npm test          # 66 个测试（单测 + smoke 协议层）
npm run typecheck # tsc --noEmit（已内置 8GB 堆，规避本机 tsc OOM 问题）
npm run build     # esbuild → dist/index.js

# 联调：让插件用本地 dist（而不是 npm 发布版）
cd ..
node scripts/dev-link.mjs          # 切到本地
node scripts/dev-link.mjs revert   # 切回 npx

# 版本号同步（plugin.json / marketplace.json / 根 package.json 三处）
npm run bump -- 0.2.0
```

## 发布

```bash
cd mcp-server
npm publish        # prepublishOnly 自动跑 typecheck + test + build
```

better-sqlite3 为 native 模块：Windows 需预编译支持（Node LTS 一般自带 prebuilt binaries；若源码编译失败，安装 windows-build-tools 或换 Node LTS 版本）。

## 目录结构

```
├── .claude-plugin/marketplace.json     # 插件市场 entry
├── plugin/
│   ├── .claude-plugin/plugin.json      # mcpServers.library → npx
│   └── skills/
│       ├── library-organize/           # 整理入库 skill
│       └── library/                    # 检索问答 skill
├── mcp-server/                         # @jesonliu/library-mcp（独立 npm 包）
└── scripts/                            # dev-link / bump-version
```

## License

MIT
