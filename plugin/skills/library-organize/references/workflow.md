# 整理入库工作流细节

## ① 读内容的所有路径

按优先级依次尝试，**任何一条通了就继续**，全部失败才请用户粘贴：

1. 用户直接粘贴了长文本 / 会议记录 → 直接用
2. 飞书文档链接（`feishu.cn/docx/...` / `feishu.cn/wiki/...`）→ 两级读取：
   - 第一级（首选）：插件自带的 lark-all-mcp 只读工具：
     - `/docx/<token>`：`mcp__lark-all-mcp__docs_v1_content_get`（Markdown，保留结构，首选）→ 失败再 `docx_v1_document_rawContent`（纯文本）→ 缺标题用 `docx_v1_document_get`
     - `/wiki/<token>`：先 `mcp__lark-all-mcp__wiki_v2_space_getNode` 用 wiki token 换 obj_token + obj_type，再按 obj_type 走 docx 分支或 base 分支
     - 缺标题/元数据：`drive_v1_meta_batchQuery`；只有文档名：`docx_builtin_search` / `wiki_v1_node_search` 搜后与用户确认
   - 第二级（lark 工具调用失败 / server 未连接时**自动降级**）：`mcp__lark-playwright__*` 用浏览器打开链接读正文，SOP 见 [playwright-fallback.md](playwright-fallback.md)；首次需扫码登录一次。仅覆盖文档类（wiki 链接渲染出的文档也走这里）；wiki 托管的多维表格不能降级，回到第 3 条的失败处理
3. 飞书多维表格链接（`feishu.cn/base/...` 或 wiki 托管）→ `bitable_v1_app_get`（Base 元数据）→ `bitable_v1_appTable_list`（数据表清单）→ `bitable_v1_appTableField_list`（先看表结构、理解字段含义）→ `bitable_v1_appTableRecord_search`（按条件筛）或 `bitable_v1_appTableRecord_list`（分页全量）；记录量大时只取需要的列、优先提炼结构；**失败时无浏览器降级**（网页版虚拟滚动 + 懒加载，无法可靠全量读取）→ 引导用户粘贴或按 README 配置 APP_ID
4. 普通网页链接 → 用网页抓取能力

**读不到时不要静默失败**：明确告诉用户"无法读取该链接，请粘贴关键内容"，整理流程不中断。

## ② 查历史的检索策略

- 关键词从内容的**核心概念**提取，不是标题照抄：会议纪要 → 提"客户名 + 项目名 + 主题词"
- 中文 trigram 特性：≥3 字的词直接子串命中（"检索增强" 能召回 "RAG 检索增强生成"），放心用自然短语
- 多个关键词一次 AND 检索（"embedding 检索"）；召回太少时拆单词放宽
- top_k=5 足够；返回的 `snippet`（⟨⟩ 包裹命中上下文）可初判相关性，拿不准再 `read` 全文

## ③ 生成整理稿的判断

| 情况 | 处理 |
|------|------|
| 无历史命中 | 首篇笔记，正常生成；links 留空 |
| 历史命中且主题相关 | links 指向它们；正文"关联笔记"段写清关联点；如有观点更新要明说 |
| 历史命中且内容高度重复 | **不要直接写入**——卡片里向用户指出重复（列出已有 doc_id + 标题），问"合并补充进已有笔记 / 仍新建一篇？" |
| 内容是原始材料（合同/规范/接口文档） | type=archive，正文以原文为主，头部加一段"归档说明" |
| 内容是讨论/会议/文章 | type=summary，提炼为主 |

## ④ 卡片确认的最低信息量

卡片（`send_text`，markdown）必须包含：

```markdown
📚 整理入库预览

**标题**：{title}
**类型**：summary | archive
**标签**：#tag1 #tag2

**关键要点**
- 要点 1
- 要点 2

**关联**：[[doc_xxx]] {其标题}（新内容更新了其中 X 观点）

确认写入知识库？
```

用户回复"确认 / 可以 / 写入"→ 执行 ⑤；用户提出修改 → 调整后**再次**发卡片确认；用户拒绝 → 结束，不写。

## ⑥ 回执格式

```
✅ 已收集整理 doc_2026-09-12_001
《标题》已入库，标签 #x #y
之后可直接说"知识库里查 {关键词}"检索到它
```

## 多文件批量整理

用户一次丢多个文件：逐个走完整流程，但确认可以**批量一张卡片**（列出每篇的标题+要点摘要），用户一次确认全部。写入逐篇调用 write（每篇独立 doc_id）。
