# Changelog

## 0.1.0（2026-09-12）

首个 MVP 版本。

### 新增

- 5 个 MCP 工具：`search` / `read` / `list` / `write` / `delete`
  - search/read/list 永远注册；write 需 `LIBRARY_ALLOW_WRITE=true`；delete 还需 `LIBRARY_ALLOW_DELETE=true` 且调用必须传 `confirm: true`
- SQLite FTS5 trigram 全文检索，<3 字符查询 LIKE 兜底；bm25 排序 + snippet
- `.md` 真相存储：frontmatter（id/type/title/source/tags/status/links）+ `[[doc_id]]` 双链解析
- 启动期自动 init：建目录、校验可写、sqlite 损坏自动备份 `.corrupt-<ts>` 重建、每次启动 FTS rebuild 防漂移
- `doc_id` 生成：`doc_YYYY-MM-DD_NNN`，meta 表原子计数，999/天上限
- write 双写（.md + sqlite 事务）与失败补偿；delete 软删除（.md 保留可恢复）
- 66 个测试：单元（storage/search/id/frontmatter/link-parser/tools）+ smoke（spawn dist 走 JSON-RPC 协议）
