// 错误类型 + 内部错误码 → 人类可读提示映射
//
// CODE_HINTS 只收录确定性提示；工具 handler 抛这些错误时，
// MCP SDK 会把 message 转成 isError 结果返回给模型。

export class LibraryError extends Error {
  constructor(
    public code: string,
    message: string,
    public hint?: string,
  ) {
    super(hint ? `${message}\n提示: ${hint}` : message);
    this.name = 'LibraryError';
  }
}

/** 只读模式下试图写 */
export class LibraryAuthError extends LibraryError {}
/** 启动期 init 失败（致命） */
export class LibraryInitError extends LibraryError {}
/** .md 文件 / sqlite IO 失败 */
export class LibraryStorageError extends LibraryError {}
/** doc_id 不存在 */
export class LibraryNotFoundError extends LibraryError {}

// 错误码 → hint
export const CODE_HINTS: Record<string, string> = {
  READONLY_MODE: '当前为只读模式：设 LIBRARY_ALLOW_WRITE=true 后重启 Claude Code 会话',
  DELETE_DISABLED: 'delete 未开启：需 LIBRARY_ALLOW_WRITE=true 且 LIBRARY_ALLOW_DELETE=true 后重启',
  CONFIRM_REQUIRED: 'delete 必须显式传 confirm: true（确认已向用户核实要删除）',
  DOC_NOT_FOUND: 'doc_id 不存在或已删除；可用 list 工具查看现有文档',
  INVALID_DOC_ID: 'doc_id 形如 doc_2026-09-12_001（前缀可经 LIBRARY_ID_PREFIX 自定义）',
  EMPTY_QUERY: '查询词为空：去掉 FTS 特殊字符后无有效内容，请换一个关键词',
  DAILY_LIMIT: '当日 doc_id 序号已达 999 上限：多为异常写入循环，请检查调用方',
  ROOT_UNWRITABLE: 'LIBRARY_ROOT 不可写：检查路径权限 / 是否被占用 / 磁盘空间',
  SQLITE_CORRUPT: 'sqlite 可能损坏：已自动备份为 .corrupt-<ts> 并重建；若 docs/*.md 完整则数据无损',
  INIT_FAILED: '启动初始化失败：检查 LIBRARY_ROOT 路径与磁盘状态',
};
