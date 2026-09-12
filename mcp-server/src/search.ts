// FTS5 trigram 全文检索 + LIKE 兜底
//
// trigram 特性（决策 #3）：
//   - 中文按 3 字符滑窗索引 → 子串召回好（"知识库" 能命中 "个人知识库设计"）
//   - 限制：MATCH 只能命中 ≥3 字符的查询串；更短的词（如 2 字中文）走 LIKE 兜底
//
// 查询构造：
//   - 剥离 FTS5 保留字符（" ' ( ) * : ^）
//   - ≥3 字符 token → phrase（"token"），多 token AND 拼接
//   - <3 字符 token → LIKE '%token%' 扫 docs 表（title/content/tags 任一命中）
//   - 两路结果合并去重，FTS 命中优先（bm25 低分在前）

import type { Database } from 'better-sqlite3';
import { LibraryError } from './errors.js';

export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
  score: number; // bm25 分（越低越好）；LIKE 兜底命中给常数 100
  tags: string[];
  type: string;
  updated_at: string;
}

export interface SearchOptions {
  topK?: number;
  type?: 'summary' | 'archive';
  tags?: string[];
  includeDraft?: boolean;
}

/** 剥离 FTS5 MATCH 表达式保留字符 */
export function cleanFtsChars(raw: string): string {
  return raw.replace(/["'()*:^]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 拆 token：≥3 字符走 FTS phrase；<3 字符走 LIKE */
export function splitTokens(cleaned: string): { longTokens: string[]; shortTokens: string[] } {
  const tokens = cleaned.split(' ').filter((t) => t.length > 0);
  const longTokens = tokens.filter((t) => [...t].length >= 3);
  const shortTokens = tokens.filter((t) => [...t].length < 3);
  return { longTokens, shortTokens };
}

/** FTS5 MATCH 表达式：多 phrase AND 拼接（供调试与测试） */
export function buildMatchExpr(longTokens: string[]): string {
  return longTokens.map((t) => `"${t}"`).join(' AND ');
}

export function searchDocs(
  db: Database,
  rawQuery: string,
  opts: SearchOptions = {},
): SearchHit[] {
  const cleaned = cleanFtsChars(rawQuery);
  if (!cleaned) {
    throw new LibraryError('EMPTY_QUERY', `查询词「${rawQuery}」清洗后为空（FTS 特殊字符已剥离）`);
  }

  const { longTokens, shortTokens } = splitTokens(cleaned);
  const topK = opts.topK ?? 5;

  const byId = new Map<string, SearchHit>();

  // 1) FTS 路（≥3 字符 token）
  if (longTokens.length) {
    const expr = buildMatchExpr(longTokens);
    const typeFilter = opts.type ? 'AND d.type = @type' : '';
    const statusFilter = opts.includeDraft
      ? "AND d.status IN ('active','draft')"
      : "AND d.status = 'active'";
    const rows = db
      .prepare(
        `SELECT d.id, d.title, d.tags, d.type, d.updated_at,
                snippet(docs_fts, 1, '⟨', '⟩', '…', 16) AS snip,
                bm25(docs_fts) AS score
         FROM docs_fts
         JOIN docs d ON d.rowid = docs_fts.rowid
         WHERE docs_fts MATCH @expr ${statusFilter} ${typeFilter}
         ORDER BY score
         LIMIT @topK * 2`,
      )
      .all({ expr, type: opts.type, topK }) as SearchHitRaw[];

    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        title: r.title,
        snippet: r.snip ?? '',
        score: r.score ?? 0,
        tags: parseTags(r.tags),
        type: r.type,
        updated_at: r.updated_at,
      });
    }
  }

  // 2) LIKE 兜底路（<3 字符 token，任一字段包含即命中）
  if (shortTokens.length) {
    const clauses = shortTokens.map(() => `(d.title LIKE ? ESCAPE '\\' OR d.content LIKE ? ESCAPE '\\' OR d.tags LIKE ? ESCAPE '\\')`);
    const params: unknown[] = [];
    for (const t of shortTokens) {
      const pat = `%${escapeLike(t)}%`;
      params.push(pat, pat, pat);
    }
    const typeFilter = opts.type ? 'AND d.type = ?' : '';
    if (opts.type) params.push(opts.type);
    const statusFilter = opts.includeDraft
      ? "AND d.status IN ('active','draft')"
      : "AND d.status = 'active'";
    const rows = db
      .prepare(
        `SELECT d.id, d.title, d.tags, d.type, d.updated_at, d.content
         FROM docs d
         WHERE ${clauses.join(' AND ')} ${statusFilter} ${typeFilter}
         LIMIT 200`,
      )
      .all(...(params as never[])) as (SearchHitRaw & { content: string })[];

    for (const r of rows) {
      if (byId.has(r.id)) continue;
      byId.set(r.id, {
        id: r.id,
        title: r.title,
        snippet: makeLikeSnippet(r.content ?? r.title, shortTokens),
        score: 100, // 兜底命中排在 FTS 之后
        tags: parseTags(r.tags),
        type: r.type,
        updated_at: r.updated_at,
      });
    }
  }

  // 3) tags 过滤 + 排序 + 截断
  let hits = [...byId.values()];
  if (opts.tags?.length) {
    const wanted = new Set(opts.tags.map((t) => t.toLowerCase()));
    hits = hits.filter((h) => h.tags.some((t) => wanted.has(t)));
  }
  hits.sort((a, b) => a.score - b.score);
  return hits.slice(0, topK);
}

// ---- 内部 ----

interface SearchHitRaw {
  id: string;
  title: string;
  tags: string | null;
  type: string;
  updated_at: string;
  snip?: string | null;
  score?: number | null;
}

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const v = JSON.parse(tags);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** LIKE 命中的手写 snippet：取首个命中词前后各 ~24 字符 */
function makeLikeSnippet(text: string, tokens: string[]): string {
  if (!text) return '';
  for (const t of tokens) {
    const idx = text.toLowerCase().indexOf(t.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 24);
      const end = Math.min(text.length, idx + t.length + 24);
      return `${start > 0 ? '…' : ''}⟨${text.slice(idx, idx + t.length)}⟩${text.slice(idx + t.length, end)}${end < text.length ? '…' : ''}`;
    }
  }
  return text.slice(0, 48);
}
