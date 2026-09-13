# library-mcp 工具速查（整理场景）

MCP server：`library-mcp`（@jesonliu/library-mcp，stdio）。工具名前缀 `mcp__library-mcp__`。

# 飞书只读工具速查（lark server，插件自带）

MCP server：`lark-all-mcp`（@larksuiteoapi/lark-mcp，stdio）。工具名前缀 `mcp__lark-all-mcp__`。
默认只注册 17 个只读工具（应用身份 tenant_access_token）；白名单可用 env `LARK_TOOLS` 覆盖，切换用户身份见 README「飞书读取能力」。

## 云文档

| 工具 | 用途 | 关键参数 |
|------|------|---------|
| `docs_v1_content_get` | 新版文档 Markdown 内容（首选，保留结构） | `doc_id` |
| `docx_v1_document_rawContent` | 文档纯文本（Markdown 失败时兜底） | `document_id` |
| `docx_v1_document_get` | 文档基本信息（标题、版本） | `document_id` |
| `docx_builtin_search` | 按名称搜索云文档 | `query`（关键词） |
| `drive_v1_meta_batchQuery` | 文件元数据（标题/类型/链接/所有者） | `request_tokens[]`、`request_types[]`（docx/wiki 等） |
| `drive_v1_file_list` | 文件夹内文件清单 | `folder_token`、分页参数 |

## 知识库 Wiki

| 工具 | 用途 | 关键参数 |
|------|------|---------|
| `wiki_v2_space_getNode` | wiki token → obj_token + obj_type（读 wiki 的必经一步） | `token`（链接里的 wiki token） |
| `wiki_v2_space_list` | 有权限的知识空间列表 | 分页参数 |
| `wiki_v2_spaceNode_list` | 空间子节点列表（浏览目录树） | `space_id`、`parent_node_token`（可选） |
| `wiki_v1_node_search` | 按名称搜索 wiki 节点 | `query`、`space_ids[]`（可选） |

## 多维表格 Bitable

| 工具 | 用途 | 关键参数 |
|------|------|---------|
| `bitable_v1_app_get` | Base 元数据（名称、是否高级权限） | `app_token` |
| `bitable_v1_appTable_list` | 数据表清单（table_id + 名称） | `app_token` |
| `bitable_v1_appTableField_list` | 字段清单（名称/类型/选项，理解记录必看） | `app_token`、`table_id` |
| `bitable_v1_appTableView_list` | 视图清单 | `app_token`、`table_id` |
| `bitable_v1_appTableRecord_search` | 按条件筛选记录（单次 ≤500 行，支持分页） | `app_token`、`table_id`、筛选/排序体 |
| `bitable_v1_appTableRecord_list` | 分页遍历全量记录（单次 ≤500 行） | `app_token`、`table_id`、`page_size`/`page_token` |
| `bitable_v1_appTableRecord_get` | 按 record_id 取单条 | `app_token`、`table_id`、`record_id` |

## 错误 → 动作

| 现象 | 动作 |
|------|------|
| 权限不足 / 无权限（如 99991672、Forbidden） | 应用身份读不到该文档：请用户把应用（机器人）加为该文档协作者，或参照 README 切换用户身份；不要反复重试 |
| lark-all-mcp 工具不在工具列表 / server 未连接 | 检查 `LARK_APP_ID` / `LARK_APP_SECRET` 是否已设置并重启会话 |
| wiki 读取 404 | token 换 obj_token 失败：确认链接完整、节点未删除；重试一次仍失败则请用户粘贴内容 |


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
