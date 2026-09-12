# 存储格式与 frontmatter 规范

> frontmatter 由 `mcp__library__write` 自动生成，模型只负责提供字段值；此文档用于理解字段语义 + 手工编辑 .md 时的规范。

## .md 文件布局

```
{LIBRARY_ROOT}/            # 默认 ~/library
├── docs/                  # 所有笔记（真相存储，可手工编辑）
│   └── doc_2026-09-12_001.md
└── .library/
    └── library.sqlite     # 索引（可删除，启动期自动从 docs 表 rebuild）
```

- **.md 是真相**：正文与 frontmatter 都以 .md 为准，可手工编辑
- sqlite 存索引 + 元数据行 + doc_id 计数 + links 边表：其中 **FTS 索引部分每次启动自动 rebuild**（从 docs 表），其余不可再生——**不要删 sqlite**；若意外损坏，服务端会自动备份 `.corrupt-<ts>` 后重建空库（此时 .md 仍在但需要重写入才能检索）

## frontmatter 字段

```yaml
---
id: doc_2026-09-12_001        # 只读；服务端生成
type: summary                 # summary | archive
title: 客户A项目周会要点
source:                       # 来源引用数组（可省略）
  - kind: feishu_doc          #   feishu_doc | feishu_bitable | manual | web | ...
    token: doccnXXX
    url: https://feishu.cn/docx/XXX
    title: 原文标题
tags: [会议, 客户a]             # 小写；2-5 个；面向主题
status: active                # active | draft | deleted（软删除标记）
created_at: 2026-09-12T10:00:00.000Z
updated_at: 2026-09-12T10:00:00.000Z
links:                        # 关联文档（可省略）
  - "[[doc_2026-09-10_005]]"
---
```

| 字段 | 语义 | write 参数对应 |
|------|------|---------------|
| id | 服务端原子生成，`doc_YYYY-MM-DD_NNN` | —（自动） |
| type | summary=提炼摘要；archive=原始归档 | `type` |
| title | 笔记标题（与正文 H1 一致） | `title` |
| source | 内容从哪来（可追溯） | `source` |
| tags | 检索过滤维度 | `tags` |
| status | deleted=软删除（检索不召回，文件保留） | —（delete 工具管理） |
| links | 显式声明的双链 | `links` |

## 正文（content）约定

```markdown
# {与 title 一致的标题}

## 📋 关键要点
- 3-6 条行动级结论

## 📖 详细摘要
（结构化正文，面向三个月后的自己）

## 🔔 关联笔记
- [[doc_2026-09-10_005]] 一句话关联点

---
*整理时间：2026-09-12*
*来源：客户A项目周会（飞书文档）*
```

- 正文中的 `[[doc_id]]` 或 `[[doc_id|别名]]` 会被解析为双链（与 frontmatter links 合并去重）
- 与 title 重复的 H1 保留（.md 单文件可读性优先）
- 尾部元信息分隔线 `---` 后跟整理时间/来源

## 手工编辑注意

- 直接改 `docs/*.md` 后**重启会话**生效（启动期 rebuild FTS）
- 手工新加的 .md 不会自动反向入索引（V1 的 rebuild_index 会解决）；需要检索到它就用 write 重写一遍
- 恢复软删除：把 status 改回 active，重启会话
