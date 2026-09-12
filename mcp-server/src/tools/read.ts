// read 工具：按 doc_id 读单篇文档全文（永远注册）
//
// .md 是真相存储：优先读 docs 表定位 path，再读 .md 解析 frontmatter。
// links 返回 frontmatter 声明 + 正文 [[doc_xxx]] 提取的合并去重结果。

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { LibraryNotFoundError, LibraryStorageError } from '../errors.js';
import { extractLinks, mergeLinks, parseFrontmatterLinks } from '../link-parser.js';
import { parseFrontmatter } from '../frontmatter.js';

export function registerReadTool(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'read',
    '按 doc_id 读取单篇知识库文档的完整内容（frontmatter 元数据 + 正文 + 合并后的双链）。',
    {
      doc_id: z.string().describe('文档 ID，形如 doc_2026-09-12_001（search/list 的返回值）'),
    },
    ({ doc_id }) => json(readDoc(ctx, doc_id)),
  );
}

/** 核心逻辑（独立于 MCP 协议，供单测直接调用） */
export function readDoc(ctx: ToolContext, docId: string): Record<string, unknown> {
  const { storage } = ctx;

  const row = storage.db
    .prepare('SELECT id, path, status FROM docs WHERE id = ?')
    .get(docId) as { id: string; path: string; status: string } | undefined;

  if (!row) {
    throw new LibraryNotFoundError('DOC_NOT_FOUND', `doc_id「${docId}」不存在`);
  }

  let raw: string;
  try {
    raw = storage.readDoc(row.path);
  } catch (e) {
    // sqlite 有记录但 .md 被手工移动/删除——提示可恢复路径
    throw new LibraryStorageError(
      'MD_MISSING',
      `文档 ${docId} 的 .md 文件读取失败: ${row.path}`,
      `sqlite 有该记录但文件缺失。若手工移动过 docs/ 下的文件，把它移回原位即可；原路径已记录在索引中 (${e instanceof Error ? e.message : String(e)})`,
    );
  }

  const { fm, body } = parseFrontmatter(raw);
  const links = mergeLinks(parseFrontmatterLinks(fm.links), extractLinks(body));

  return {
    doc_id: fm.id || row.id,
    type: fm.type,
    title: fm.title,
    tags: fm.tags ?? [],
    status: fm.status,
    source: fm.source ?? [],
    created_at: fm.created_at,
    updated_at: fm.updated_at,
    links: links.map((l) => (l.alias ? `${l.docId}|${l.alias}` : l.docId)),
    content: body,
  };
}

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
