# library-mcp 工具速查（检索场景）

MCP server：`library`（@jesonliu/library-mcp，stdio）。工具名前缀 `mcp__library__`。
本 skill 只用 3 个只读工具（search / read / list），全部永远可用。

## search

```jsonc
{
  "query": "中文检索增强",   // 必填；自然语言，多词 AND
  "top_k": 5,               // 可选，默认 5
  "type": "summary",        // 可选：summary | archive
  "tags": ["rag"]           // 可选：命中任一即保留
}
```

返回：

```jsonc
{
  "query": "中文检索增强",
  "total": 2,
  "hits": [
    {
      "doc_id": "doc_2026-09-12_001",
      "title": "RAG 检索增强生成调研",
      "snippet": "关于 ⟨中文检索增强⟩ 与重排的技术调研",
      "tags": ["rag"],
      "type": "summary",
      "updated_at": "2026-09-12T10:00:00.000Z"
    }
  ]
}
```

- bm25 排序（相关在前）；snippet 的 `⟨⟩` 是命中上下文标记
- 已删除（status=deleted）不召回
- 查询词里的 `" ' ( ) * : ^` 自动剥离

## read

```jsonc
{ "doc_id": "doc_2026-09-12_001" }
```

返回 `{ doc_id, type, title, tags, status, source[], created_at, updated_at, links[], content }`。

- content 为正文全文（markdown，含 `[[doc_id]]` 双链原文）
- links 是 frontmatter 声明 + 正文提取的合并去重结果

## list

```jsonc
{
  "type": "summary",   // 可选
  "tags": ["会议"],     // 可选
  "status": "active",  // 可选；缺省 active+draft（不含已删除）
  "limit": 20          // 可选，默认 20
}
```

按 updated_at 倒序，只返回摘要（无正文）。浏览全库 / 给用户看清单时用。

## 错误码 → 动作

| 错误信息含 | 动作 |
|-----------|------|
| EMPTY_QUERY | 换实质关键词（当前词清洗后为空） |
| DOC_NOT_FOUND | doc_id 拼错或已删除；重新 search 取新结果 |
| MD_MISSING | .md 文件被移动/删除但索引有记录——告知用户文件路径异常，建议检查 docs/ 目录 |
