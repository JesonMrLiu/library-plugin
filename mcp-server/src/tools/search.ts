// search 工具：FTS5 trigram 全文检索（永远注册）

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { searchDocs } from '../search.js';

export function registerSearchTool(server: McpServer, ctx: ToolContext): void {
  const { storage, config } = ctx;

  server.tool(
    'search',
    '在个人知识库中全文检索。中文子串召回好（trigram 分词）：如「检索增强」能命中「RAG 检索增强生成」。' +
      '返回 doc_id + 标题 + 命中摘要（⟨⟩ 包裹）+ bm25 排序；需要全文时再用 read 工具取 doc_id。',
    {
      query: z.string().describe('自然语言查询词；支持中英混合，多个词按 AND 召回'),
      top_k: z.number().int().min(1).max(50).optional().describe(`返回条数上限，默认 ${config.searchDefaultTopK}`),
      type: z.enum(['summary', 'archive']).optional().describe('按文档类型过滤'),
      tags: z.array(z.string()).optional().describe('按标签过滤（命中任一即保留）'),
    },
    ({ query, top_k, type, tags }) => {
      const hits = searchDocs(storage.db, query, {
        topK: top_k ?? config.searchDefaultTopK,
        type,
        tags,
      });
      return json({
        query,
        total: hits.length,
        hits: hits.map((h) => ({
          doc_id: h.id,
          title: h.title,
          snippet: h.snippet,
          tags: h.tags,
          type: h.type,
          updated_at: h.updated_at,
        })),
      });
    },
  );
}

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
