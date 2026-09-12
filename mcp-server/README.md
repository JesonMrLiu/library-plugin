# @jesonliu/library-mcp

个人知识库 MCP server：本地 `.md` 真相存储 + SQLite FTS5（trigram）全文索引。

通常经 [library-plugin](../README.md) 的 Claude Code 插件使用；也可作为独立 MCP server 接入任意客户端。

## 快速开始

```bash
# 环境变量（可选；全有默认值）
export LIBRARY_ROOT="$HOME/library"    # 知识库根目录
export LIBRARY_ALLOW_WRITE=true        # 开启 write（默认 false 只读）
export LIBRARY_ALLOW_DELETE=true       # 开启 delete（还需 WRITE 同开）

npx -y @jesonliu/library-mcp           # stdio JSON-RPC
```

首次启动自动初始化：创建 `docs/` 与 `.library/library.sqlite`，建表并 rebuild FTS 索引。

## 工具

| 工具 | 注册条件 | 参数 |
|------|---------|------|
| `search` | 永远 | `query`（必填）、`top_k?`、`type?`（summary/archive）、`tags?` |
| `read` | 永远 | `doc_id` |
| `list` | 永远 | `type?`、`tags?`、`status?`、`limit?` |
| `write` | `LIBRARY_ALLOW_WRITE=true` | `type`、`title`、`content`、`tags?`、`source?`、`links?` |
| `delete` | WRITE + `LIBRARY_ALLOW_DELETE=true` | `doc_id`、`confirm: true`（必传） |

启动日志（stderr）会打印 `write: ENABLED|DISABLED` / `delete: ENABLED|DISABLED`，配置问题第一时间可见。

## 检索特性

- **trigram 分词**：≥3 字符查询走 FTS5 phrase（中文子串召回好：查「检索增强」命中《RAG 检索增强生成》），bm25 排序 + snippet（`⟨⟩` 包裹命中上下文）
- **LIKE 兜底**：<3 字符查询（如 2 字中文「排期」）自动走 `LIKE '%…%'`，排在 FTS 命中之后
- 默认排除软删除（`status=deleted`）文档
- 查询中的 FTS 保留字符 `" ' ( ) * : ^` 自动剥离

## 存储

```
{LIBRARY_ROOT}/
├── docs/doc_2026-09-12_001.md   # 真相存储（可手工编辑；frontmatter + 正文）
└── .library/library.sqlite      # docs 表 + docs_fts + links + meta（doc_id 计数）
```

- `write` 双写 `.md` + sqlite（事务 + 失败补偿）
- `delete` 软删除：sqlite `status` 与 `.md` frontmatter 同步；文件保留，改回 `status: active` 可恢复
- 每次启动 rebuild FTS 索引（防漂移）；sqlite 损坏自动备份 `.corrupt-<ts>` 后重建空库
- `doc_id`：`{prefix}YYYY-MM-DD_NNN`（默认 `doc_`，999/天上限，meta 表原子计数）

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `LIBRARY_ROOT` | `~/library` | 根目录（建议本地盘） |
| `LIBRARY_DOCS_SUBDIR` | `docs` | 笔记子目录 |
| `LIBRARY_METADATA_DIR` | `.library` | 元数据目录 |
| `LIBRARY_SQLITE_NAME` | `library.sqlite` | sqlite 文件名 |
| `LIBRARY_ALLOW_WRITE` | `false` | write 工具开关 |
| `LIBRARY_ALLOW_DELETE` | `false` | delete 工具开关 |
| `LIBRARY_SEARCH_DEFAULT_TOPK` | `5` | search 默认条数 |
| `LIBRARY_LIST_DEFAULT_LIMIT` | `20` | list 默认条数 |
| `LIBRARY_LOG_LEVEL` | `info` | debug/info/warn/error（stderr） |
| `LIBRARY_ID_PREFIX` | `doc_` | doc_id 前缀 |

## 开发

```bash
npm install
npm test          # vitest：frontmatter/link-parser/storage/id/search/tools/smoke
npm run typecheck # tsc --noEmit（内置 8GB 堆）
npm run build     # esbuild → dist/index.js（better-sqlite3 external）
```

- 日志走 stderr；stdout 只输出 JSON-RPC（stdio transport 约定）
- better-sqlite3 是 native 模块，随包正常安装（esbuild 只 external 不 bundle）

## License

MIT
