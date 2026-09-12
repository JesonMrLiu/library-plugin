// 正文双链解析：[[doc_xxx]] 与 [[doc_xxx|别名]]
//
// links 既存在于 frontmatter（显式声明），也可散落在正文（自然书写）。
// read 工具返回两处合并去重的结果。

export interface ExtractedLink {
  docId: string;
  alias?: string;
}

const LINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

/** 提取正文里所有 [[...]] 链接 */
export function extractLinks(body: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(LINK_RE)) {
    const docId = m[1].trim();
    if (!docId || seen.has(docId)) continue;
    seen.add(docId);
    const alias = m[2]?.trim();
    out.push(alias ? { docId, alias } : { docId });
  }
  return out;
}

/** frontmatter links 数组（"[[doc_xxx]]" 形态）→ ExtractedLink[] */
export function parseFrontmatterLinks(links?: string[]): ExtractedLink[] {
  if (!links?.length) return [];
  return extractLinks(links.join(' '));
}

/** 合并 frontmatter links 与正文 links（去重，frontmatter 优先） */
export function mergeLinks(fmLinks: ExtractedLink[], bodyLinks: ExtractedLink[]): ExtractedLink[] {
  const map = new Map<string, ExtractedLink>();
  for (const l of bodyLinks) map.set(l.docId, l);
  for (const l of fmLinks) map.set(l.docId, l); // 覆盖
  return [...map.values()];
}
