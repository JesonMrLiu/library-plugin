---
name: library-organize
description: >
  把用户丢来的飞书文档/多维表格/长文内容整理进个人知识库：读取内容 → 检索历史关联 →
  生成摘要笔记（关键要点 + 详细摘要 + 双链 + 标签）→ 卡片确认 → 写入本地 .md + 索引。
  当用户说"帮我整理这个"、"整理入库"、"收集整理"、"存进知识库"、"保存到知识库"、
  "把这个加进笔记"并附带文件/链接/长文本时，使用此 skill。
argument-hint: "[飞书文档链接 / 多维表格链接 / 或直接粘贴的内容]"
allowed-tools:
  - mcp__library-mcp__search
  - mcp__library-mcp__read
  - mcp__library-mcp__list
  - mcp__library-mcp__write
  - mcp__lcb-notify__send_text
  - mcp__lark-all-mcp
---

# 飞书文件整理入库（library-organize）

> ⛔ **写入红线**（违反任何一条都不要继续）：
> 1. **写前必 search**：先用 `mcp__library-mcp__search` 检索同主题历史（3-5 条），已有高度重复的笔记时向用户说明并建议合并/补充，而不是盲目新建
> 2. **写前必确认**：整理结果必须先以卡片形式展示给用户，得到明确"确认"后才调用 `mcp__library-mcp__write`；用户没确认前绝不写入
> 3. **write 工具不存在时**：说明当前为只读模式（`LIBRARY_ALLOW_WRITE=false`），引导用户设置 env 后重启会话，不要反复重试
> 4. **双链只指向真实存在的 doc_id**：从 search 结果里拿，绝不编造 doc_id

## 1. 工作流总览（六步）

```
① 读内容 → ② 查历史 → ③ 生成整理稿 → ④ 卡片确认 → ⑤ 写入 → ⑥ 回执
```

| 步骤 | 动作 | 要点 |
|------|------|------|
| ① 读内容 | lark-all-mcp 飞书只读工具 / 用户粘贴 | 拿到标题 + 正文；读不到链接时请用户粘贴关键内容，不要卡死 |
| ② 查历史 | `mcp__library-mcp__search` | 用内容核心关键词（3-5 个）检索，top_k=5；无历史也继续（首篇笔记） |
| ③ 生成整理稿 | Claude 分析 | 决定 type（summary/archive）+ 正文模板 + tags + links（指向②命中的 doc_id） |
| ④ 卡片确认 | `send_text` | 展示标题/要点/tags/双链，明确问"确认写入知识库？" |
| ⑤ 写入 | `mcp__library-mcp__write` | 一次性提交 type/title/content/tags/source/links |
| ⑥ 回执 | 对话回复 | "已收集整理 doc_YYYY-MM-DD_NNN"，附一句内容定位 |

### ①-a 飞书链接读取指引（lark-all-mcp server，插件自带只读）

按链接形态分流（默认 17 个只读工具；白名单可用 env `LARK_TOOLS` 覆盖，实名以 `/mcp` 实际注册为准）：

| 链接形态 | 调用链 |
|---------|--------|
| `/docx/<token>` 新版文档 | `mcp__lark-all-mcp__docs_v1_content_get`（Markdown，首选，保留结构）；失败再 `docx_v1_document_rawContent`（纯文本兜底）；缺标题用 `docx_v1_document_get` |
| `/wiki/<token>` 知识库节点 | 先 `mcp__lark-all-mcp__wiki_v2_space_getNode` 换 obj_token + obj_type，再按 obj_type 走 docx 或 base 分支（wiki 托管的多维表格同样如此） |
| `/base/<app_token>` 多维表格 | `bitable_v1_app_get`（Base 元数据）→ `bitable_v1_appTable_list`（数据表清单）→ `bitable_v1_appTableField_list`（字段含义，整理记录必看）→ `bitable_v1_appTableRecord_search`（按条件筛选）或 `bitable_v1_appTableRecord_list`（分页全量） |
| 只有链接、缺标题 | `drive_v1_meta_batchQuery` 补元数据 |
| 只有文档名、没链接 | `docx_builtin_search` / `wiki_v1_node_search` 搜索后向用户确认目标 |

- 多维表格记录量大时分页取，整理时优先提炼结构（字段含义 + 关键记录），不要把全表原样塞进笔记
- lark-all-mcp 工具报权限错误（应用身份读不到该文档）→ 请用户把应用加为该文档协作者，或参照 README 切换用户身份；不要反复重试

## 2. type 怎么选

| type | 场景 |
|------|------|
| `summary` | Claude 提炼过的摘要笔记（默认；绝大多数情况） |
| `archive` | 原文几乎不动、以备将来回查的原始归档（如合同、规范全文） |

## 3. 正文模板（content）

```markdown
# {标题}

## 📋 关键要点
- 3-6 条，每条一句可直接行动/引用的结论

## 📖 详细摘要
（结构化正文；面向"三个月后的自己"能看懂）

## 🔔 关联笔记
- [[doc_xxx]] 一句话说清关联点（没有关联时整节省略）

---
*整理时间：YYYY-MM-DD*
*来源：{飞书文档标题 / 链接}*
```

frontmatter 字段与 tags/links 规范：[references/frontmatter-schema.md](references/frontmatter-schema.md)

## 4. 整理方法论

- 检索历史后**融合而不是并列**：历史笔记与本次内容有重叠时，指出"新内容更新/推翻了哪条旧观点"
- tags 控制在 2-5 个、小写、面向主题而非来源（`rag` ✓ `飞书导入的` ✗）
- links 只指向 ② 里真实命中的 doc_id；在"关联笔记"段落同时用 `[[doc_id]]` 双链语法书写

细节：[references/workflow.md](references/workflow.md)

## 5. 工具速查

5 个工具的完整参数与错误码：[references/mcp-tools.md](references/mcp-tools.md)

## 6. 错误诊断

| 现象 | 原因与处理 |
|------|-----------|
| write 工具不在工具列表 | 只读模式：引导设 `LIBRARY_ALLOW_WRITE=true` 后重启会话 |
| 提示 DAILY_LIMIT | 当日已写 999 篇（多为异常循环），停下来向用户报告 |
| 提示 EMPTY_QUERY | search 关键词清洗后为空，换实质关键词 |
| 提示 DOC_NOT_FOUND | links 里指向了不存在的 doc_id，从 search 结果重新取 |
| lark-all-mcp 工具报权限不足/无权限 | 应用身份（tenant_access_token）读不到该文档：请用户把应用加为协作者，或参照 README 切换用户身份 |
| lark-all-mcp server 未连接/工具不存在 | 检查 `LARK_APP_ID` / `LARK_APP_SECRET` 是否已设置并重启会话；未配置时引导用户按 README「飞书读取能力」开通 |
