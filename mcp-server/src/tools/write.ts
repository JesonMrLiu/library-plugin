// write 工具：写入一篇新文档（.md + sqlite 双写，注册条件 LIBRARY_ALLOW_WRITE=true）
//
// 原子性策略：
//   1. 生成 doc_id（meta 表原子计数）
//   2. 先写 .md（失败 → 无 sqlite 副作用，直接抛）
//   3. sqlite 事务：INSERT docs（触发器自动同步 FTS）+ links
//   4. sqlite 失败 → 删除已写的 .md 补偿后抛出
//
// links 表有 FK 约束（dst 必须存在），指向不存在 doc_id 的链接会被跳过并提示。

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { unlinkSync } from 'node:fs';
import type { ToolContext } from '../context.js';
import { LibraryAuthError } from '../errors.js';
import { normalizeTags, serializeFrontmatter, type DocFrontmatter, type SourceRef } from '../frontmatter.js';
import { generateDocId } from '../id.js';
import { extractLinks, mergeLinks } from '../link-parser.js';

export interface WriteArgs {
  type: 'summary' | 'archive';
  title: string;
  content: string;
  tags?: string[];
  source?: SourceRef[];
  links?: string[];
}

export function registerWriteTool(server: McpServer, ctx: ToolContext): void {
  const { config } = ctx;

  server.tool(
    'write',
    '向知识库写入一篇新文档（.md 真相存储 + sqlite 索引双写），返回生成的 doc_id。' +
      '写入前建议先 search 检索历史避免重复主题。tags 会统一小写去重；links 接受 doc_id 数组或 [[doc_id]] 形态。',
    {
      type: z.enum(['summary', 'archive']).describe('summary=日常整理的摘要笔记；archive=原始归档'),
      title: z.string().min(1).describe('文档标题'),
      content: z.string().min(1).describe('正文（markdown，支持 [[doc_id]] 双链语法）'),
      tags: z.array(z.string()).optional().describe('标签列表（自动小写去重）'),
      source: z
        .array(
          z.object({
            kind: z.string().describe('来源类型：feishu_doc | feishu_bitable | manual | ...'),
            token: z.string().optional(),
            url: z.string().optional(),
            title: z.string().optional(),
          }),
        )
        .optional()
        .describe('来源引用（如飞书文档 token/url）'),
      links: z
        .array(z.string())
        .optional()
        .describe('关联文档 doc_id 列表（自动规范化为 [[doc_id]] 存 frontmatter）'),
    },
    (args) => json(writeDoc(ctx, args)),
  );
  void config;
}

/** 核心逻辑（独立于 MCP 协议，供单测直接调用） */
export function writeDoc(ctx: ToolContext, args: WriteArgs): Record<string, unknown> {
  const { storage, config } = ctx;
  if (!config.allowWrite) {
    // 注册条件兜底（正常不会走到——未开启时工具不注册）
    throw new LibraryAuthError('READONLY_MODE', '当前为只读模式，write 不可用');
  }

  const now = new Date().toISOString();
  const dateKey = now.slice(0, 10);
  const docId = generateDocId(storage.db, config.idPrefix, dateKey);

  // links：参数声明的 + 正文 [[...]] 提取的合并去重
  // 参数兼容裸 doc_id 与 [[doc_id]] 两种写法（frontmatter.parseLinks 同款语义）
  const declared = extractLinks(
    (args.links ?? []).map((l) => (l.startsWith('[[') ? l : `[[${l}]]`)).join(' '),
  );
  const fromBody = extractLinks(args.content);
  const merged = mergeLinks(declared, fromBody);

  const fm: DocFrontmatter = {
    id: docId,
    type: args.type,
    title: args.title.trim(),
    source: args.source ?? [],
    tags: normalizeTags(args.tags),
    status: 'active',
    created_at: now,
    updated_at: now,
    links: merged.map((l) => `[[${l.docId}]]`),
  };

  const path = `${storage.docsDir}/${docId}.md`;
  const md = serializeFrontmatter(fm, args.content);
  storage.writeDocAtomic(path, md);

  // links 表只存指向已存在文档的边（FK 约束）；不存在的 dst 跳过并提示
  const existing = new Set(
    (storage.db.prepare('SELECT id FROM docs').all() as { id: string }[]).map((r) => r.id),
  );
  const dangling = merged.filter((l) => !existing.has(l.docId)).map((l) => l.docId);
  if (dangling.length) {
    console.error(
      `[library-mcp] ⚠ write ${docId}: links 指向不存在的 doc_id，已跳过入库（仍保留在 frontmatter）: ${dangling.join(', ')}`,
    );
  }
  const edges = merged.filter((l) => existing.has(l.docId));

  const tx = storage.db.transaction(() => {
    storage.db
      .prepare(
        `INSERT INTO docs (id, type, path, title, content, source, tags, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        docId,
        args.type,
        path,
        fm.title,
        args.content,
        fm.source?.length ? JSON.stringify(fm.source) : null,
        fm.tags?.length ? JSON.stringify(fm.tags) : null,
        fm.status,
        now,
        now,
      );
    const insertLink = storage.db.prepare(
      'INSERT INTO links (src_doc_id, dst_doc_id, kind, created_at) VALUES (?, ?, ?, ?)',
    );
    for (const e of edges) insertLink.run(docId, e.docId, 'related', now);
  });

  try {
    tx();
  } catch (e) {
    // 补偿：sqlite 写失败时移除已写的 .md，避免留下无索引的孤儿文件
    try {
      unlinkSync(path);
    } catch {
      /* 补偿失败也只能尽力 */
    }
    throw e;
  }

  return {
    doc_id: docId,
    path,
    type: args.type,
    title: fm.title,
    tags: fm.tags ?? [],
    links: merged.map((l) => l.docId),
    ...(dangling.length ? { skipped_links: dangling } : {}),
  };
}

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
