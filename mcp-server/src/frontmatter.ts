// gray-matter 包装：frontmatter 解析 / 序列化 / 缺字段兜底
//
// .md 是真相存储，frontmatter 字段约定（设计文档 §7）：
// id / type / title / source / tags / status / created_at / updated_at / links

import matter from 'gray-matter';

export type DocType = 'summary' | 'archive';
export type DocStatus = 'active' | 'draft' | 'deleted';

export interface SourceRef {
  kind: string; // feishu_doc | feishu_bitable | manual | ...
  token?: string;
  url?: string;
  title?: string;
}

export interface DocFrontmatter {
  id: string;
  type: DocType;
  title: string;
  source?: SourceRef[];
  tags?: string[];
  status: DocStatus;
  created_at: string; // ISO8601
  updated_at: string; // ISO8601
  links?: string[]; // ["[[doc_xxx]]"]
}

/** 缺字段兜底：YAML 手写的 .md 可能缺任一字段 */
export function ensureDefaults(partial: Partial<DocFrontmatter>): DocFrontmatter {
  const now = new Date().toISOString();
  return {
    id: partial.id ?? '',
    type: partial.type === 'archive' ? 'archive' : 'summary',
    title: partial.title ?? 'untitled',
    source: Array.isArray(partial.source) ? partial.source : [],
    tags: normalizeTags(partial.tags),
    status: partial.status === 'draft' || partial.status === 'deleted' ? partial.status : 'active',
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? partial.created_at ?? now,
    links: Array.isArray(partial.links) ? partial.links : [],
  };
}

/** tags 规范化：去空白 / 小写 / 去重 */
export function normalizeTags(tags?: string[] | string): string[] {
  if (!tags) return [];
  const arr = Array.isArray(tags) ? tags : String(tags).split(',');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of arr) {
    const v = String(t).trim().toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** 解析 .md 全文 → { frontmatter, body }；缺字段自动兜底 */
export function parseFrontmatter(raw: string): { fm: DocFrontmatter; body: string } {
  const parsed = matter(raw);
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  return {
    fm: ensureDefaults({
      id: typeof data.id === 'string' ? data.id : undefined,
      type: data.type === 'archive' ? 'archive' : data.type === 'summary' ? 'summary' : undefined,
      title: typeof data.title === 'string' ? data.title : undefined,
      source: parseSource(data.source),
      tags: data.tags as string[] | undefined,
      status: data.status as DocStatus | undefined,
      created_at: typeof data.created_at === 'string' ? data.created_at : undefined,
      updated_at: typeof data.updated_at === 'string' ? data.updated_at : undefined,
      links: parseLinks(data.links),
    }),
    body: parsed.content,
  };
}

/** 序列化 frontmatter + body → .md 全文（写入磁盘的唯一出口） */
export function serializeFrontmatter(fm: DocFrontmatter, body: string): string {
  const data: Record<string, unknown> = {
    id: fm.id,
    type: fm.type,
    title: fm.title,
  };
  if (fm.source?.length) data.source = fm.source;
  if (fm.tags?.length) data.tags = fm.tags;
  data.status = fm.status;
  data.created_at = fm.created_at;
  data.updated_at = fm.updated_at;
  if (fm.links?.length) data.links = fm.links;

  // gray-matter.stringify 对嵌套对象输出 JSON 风格 YAML，稳定可回读
  return matter.stringify(body.trimEnd() + '\n', data);
}

// source 字段 YAML 里可能是数组（对象/字符串混合），统一成 SourceRef[]
function parseSource(v: unknown): SourceRef[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .map((item) => {
      if (typeof item === 'string') return { kind: item };
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        return {
          kind: String(o.kind ?? 'unknown'),
          token: o.token === undefined ? undefined : String(o.token),
          url: o.url === undefined ? undefined : String(o.url),
          title: o.title === undefined ? undefined : String(o.title),
        };
      }
      return { kind: 'unknown' };
    })
    .filter(Boolean) as SourceRef[];
}

// links 字段兼容 "doc_xxx" 与 "[[doc_xxx]]" 两种写法，统一存 [[doc_xxx]]
function parseLinks(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map((item) => {
    const s = String(item).trim();
    return s.startsWith('[[') && s.endsWith(']]') ? s : `[[${s}]]`;
  });
}
