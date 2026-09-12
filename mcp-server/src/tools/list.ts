// list 工具：浏览知识库文档列表（永远注册）
//
// 返回摘要（不含正文）；默认排除已软删除的文档。

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from '../context.js';

export interface ListArgs {
  type?: 'summary' | 'archive';
  tags?: string[];
  status?: 'active' | 'draft' | 'deleted';
  limit?: number;
}

export function registerListTool(server: McpServer, ctx: ToolContext): void {
  const { config } = ctx;

  server.tool(
    'list',
    '列出知识库文档（按更新时间倒序，摘要不含正文）。浏览库、核对 doc_id、找最近写入的笔记时用它。',
    {
      type: z.enum(['summary', 'archive']).optional().describe('按文档类型过滤'),
      tags: z.array(z.string()).optional().describe('按标签过滤（命中任一即保留）'),
      status: z
        .enum(['active', 'draft', 'deleted'])
        .optional()
        .describe('按状态过滤；缺省时返回 active + draft（排除已删除）'),
      limit: z.number().int().min(1).max(200).optional().describe(`返回条数上限，默认 ${config.listDefaultLimit}`),
    },
    (args) => json(listDocs(ctx, args)),
  );
}

/** 核心逻辑（独立于 MCP 协议，供单测直接调用） */
export function listDocs(ctx: ToolContext, args: ListArgs): Record<string, unknown> {
  const { storage, config } = ctx;

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (args.status) {
    conditions.push('status = @status');
    params.status = args.status;
  } else {
    conditions.push("status IN ('active','draft')");
  }
  if (args.type) {
    conditions.push('type = @type');
    params.type = args.type;
  }

  // tags 过滤在 SQL 后做（JSON 数组 contains 语义，命中任一即保留）
  params.limit = args.limit ?? config.listDefaultLimit;

  const rows = storage.db
    .prepare(
      `SELECT id, type, title, tags, status, created_at, updated_at
       FROM docs
       WHERE ${conditions.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT @limit * 4`,
    )
    .all(params) as ListRow[];

  let items = rows.map((r) => ({
    doc_id: r.id,
    type: r.type,
    title: r.title,
    tags: parseTags(r.tags),
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  if (args.tags?.length) {
    const wanted = new Set(args.tags.map((t) => t.toLowerCase()));
    items = items.filter((it) => it.tags.some((t) => wanted.has(t)));
  }
  items = items.slice(0, params.limit as number);

  return { total: items.length, items };
}

interface ListRow {
  id: string;
  type: string;
  title: string;
  tags: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const v = JSON.parse(tags);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
