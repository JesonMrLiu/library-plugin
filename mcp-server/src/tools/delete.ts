// delete 工具：软删除文档（注册条件 LIBRARY_ALLOW_WRITE=true 且 LIBRARY_ALLOW_DELETE=true）
//
// 软删除 = docs 表 status='deleted' + .md frontmatter 同步（search/list 默认不再返回）。
// .md 文件保留在 docs/ 下，用户可手工改回 status=active 恢复。

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { LibraryAuthError, LibraryNotFoundError, LibraryStorageError } from '../errors.js';
import { parseFrontmatter, serializeFrontmatter } from '../frontmatter.js';

export function registerDeleteTool(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'delete',
    '⚠️ 软删除一篇知识库文档（标记 status=deleted，默认检索不再返回；.md 文件保留可手工恢复）。' +
      '需 LIBRARY_ALLOW_WRITE=true 且 LIBRARY_ALLOW_DELETE=true，且必须显式传 confirm: true。' +
      '删除前建议先 read 确认内容。',
    {
      doc_id: z.string().describe('要删除的文档 ID'),
      confirm: z
        .literal(true)
        .describe('安全确认：必须显式传 true（确认已向用户核实要删除这篇文档）'),
    },
    ({ doc_id }) => json(deleteDoc(ctx, doc_id)),
  );
}

/** 核心逻辑（独立于 MCP 协议，供单测直接调用） */
export function deleteDoc(ctx: ToolContext, docId: string): Record<string, unknown> {
  const { storage, config } = ctx;
  if (!config.allowWrite || !config.allowDelete) {
    throw new LibraryAuthError('DELETE_DISABLED', 'delete 未开启（需 ALLOW_WRITE + ALLOW_DELETE 同时为 true）');
  }

  const row = storage.db
    .prepare('SELECT id, path, status FROM docs WHERE id = ?')
    .get(docId) as { id: string; path: string; status: string } | undefined;
  if (!row) {
    throw new LibraryNotFoundError('DOC_NOT_FOUND', `doc_id「${docId}」不存在`);
  }
  if (row.status === 'deleted') {
    return { doc_id: docId, deleted: true, already: true, mode: 'soft' };
  }

  // .md frontmatter 同步（.md 是真相存储）
  try {
    const { fm, body } = parseFrontmatter(storage.readDoc(row.path));
    fm.status = 'deleted';
    fm.updated_at = new Date().toISOString();
    storage.writeDocAtomic(row.path, serializeFrontmatter(fm, body));
  } catch (e) {
    throw new LibraryStorageError(
      'MD_MISSING',
      `文档 ${docId} 的 .md 文件同步失败: ${row.path}`,
      `sqlite 记录存在但 .md 读写失败 (${e instanceof Error ? e.message : String(e)})`,
    );
  }

  const now = new Date().toISOString();
  storage.db
    .prepare('UPDATE docs SET status = ?, updated_at = ? WHERE id = ?')
    .run('deleted', now, docId);

  return {
    doc_id: docId,
    deleted: true,
    mode: 'soft',
    note: '.md 保留在 docs/ 下，可改回 status=active 恢复',
  };
}

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
