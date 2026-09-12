# library-mcp 工具速查（整理场景）

MCP server：`library`（@jesonliu/library-mcp，stdio）。工具名前缀 `mcp__library__`。

## search（永远可用）

```jsonc
{
  "query": "中文检索增强",   // 必填；自然语言，多词 AND
  "top_k": 5,               // 可选，默认 5（LIBRARY_SEARCH_DEFAULT_TOPK）
  "type": "summary",        // 可选：summary | archive
  "tags": ["rag"]           // 可选：命中任一即保留
}
```

返回 `{ hits: [{ doc_id, title, snippet, tags, type, updated_at }] }`。
- snippet 中 `⟨...⟩` 包裹命中片段
- bm25 排序，越靠前越相关
- 默认排除已删除（status=deleted）文档

## read（永远可用）

```jsonc
{ "doc_id": "doc_2026-09-12_001" }
```

返回 `{ doc_id, type, title, tags, status, source[], created_at, updated_at, links[], content }`。
content 是正文全文（含双链原文）。

## list（永远可用）

```jsonc
{
  "type": "summary",        // 可选
  "tags": ["会议"],          // 可选
  "status": "active",       // 可选；缺省 active+draft
  "limit": 20               // 可选，默认 20
}
```

按 updated_at 倒序。浏览库 / 核对 doc_id 时用。

## write（需 LIBRARY_ALLOW_WRITE=true，否则不注册）

```jsonc
{
  "type": "summary",        // 必填：summary | archive
  "title": "客户A项目周会要点",  // 必填
  "content": "# 标题\n\n## 📋 关键要点\n...",  // 必填，markdown 正文
  "tags": ["会议", "客户a"],    // 可选；自动小写去重
  "source": [               // 可选；来源引用
    { "kind": "feishu_doc", "token": "doccnXXX", "url": "https://...", "title": "原文标题" }
  ],
  "links": ["doc_2026-09-10_005"]  // 可选；裸 doc_id 或 [[doc_id]] 均可
}
```

返回 `{ doc_id, path, type, title, tags, links, skipped_links? }`。
- doc_id 自动生成（`doc_YYYY-MM-DD_NNN`，999/天上限）
- .md 与 sqlite 双写；指向不存在 doc_id 的 links 会跳过入边表（frontmatter 保留）
- 正文里的 `[[doc_id]]` 双链同样会被索引

## delete（需 ALLOW_WRITE + ALLOW_DELETE 双开，否则不注册）

整理场景**不主动使用**；仅在用户明确说"删掉那篇"且工具存在时，先 read 展示内容，用户确认后带 `confirm: true` 调用。软删除（.md 保留，可手工恢复）。

## 错误码 → 动作

| 错误信息含 | 动作 |
|-----------|------|
| READONLY_MODE / write 不存在 | 引导用户设 `LIBRARY_ALLOW_WRITE=true` 重启会话 |
| DAILY_LIMIT | 停止写入，向用户报告异常 |
| EMPTY_QUERY | 换实质关键词重试 |
| DOC_NOT_FOUND | doc_id 拼错或已删；用 list 核对 |
| CONFIRM_REQUIRED | delete 未带 confirm:true，补上 |
