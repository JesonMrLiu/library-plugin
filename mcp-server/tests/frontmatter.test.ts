// frontmatter 解析 / 序列化 / 兜底 单测（纯函数，零 IO）

import { describe, expect, it } from 'vitest';
import {
  ensureDefaults,
  normalizeTags,
  parseFrontmatter,
  serializeFrontmatter,
  type DocFrontmatter,
} from '../src/frontmatter.js';

const FULL_FM = `---
id: doc_2026-09-11_001
type: summary
title: "客户 A 上周会议总结"
source:
  - kind: feishu_doc
    token: doccnXXX
    url: "https://feishu.cn/docs/doccnXXX"
tags: ["会议", "客户A"]
status: active
created_at: 2026-09-11T10:00:00.000Z
updated_at: 2026-09-11T10:00:00.000Z
links:
  - "[[doc_2026-09-10_005]]"
---
# 客户 A 上周会议总结

正文内容。
`;

describe('parseFrontmatter', () => {
  it('完整 frontmatter 全字段解析', () => {
    const { fm, body } = parseFrontmatter(FULL_FM);
    expect(fm.id).toBe('doc_2026-09-11_001');
    expect(fm.type).toBe('summary');
    expect(fm.title).toBe('客户 A 上周会议总结');
    expect(fm.source).toEqual([
      { kind: 'feishu_doc', token: 'doccnXXX', url: 'https://feishu.cn/docs/doccnXXX' },
    ]);
    expect(fm.tags).toEqual(['会议', '客户a']); // normalizeTags 小写化
    expect(fm.status).toBe('active');
    expect(fm.links).toEqual(['[[doc_2026-09-10_005]]']);
    expect(body).toContain('# 客户 A 上周会议总结');
    expect(body).toContain('正文内容');
  });

  it('缺字段的 .md 自动兜底', () => {
    const { fm } = parseFrontmatter('---\ntitle: 仅标题\n---\n正文\n');
    expect(fm.id).toBe('');
    expect(fm.type).toBe('summary'); // 默认
    expect(fm.status).toBe('active'); // 默认
    expect(fm.tags).toEqual([]);
    expect(fm.source).toEqual([]);
    expect(fm.links).toEqual([]);
    expect(fm.created_at).toBeTruthy();
    expect(fm.updated_at).toBeTruthy();
  });

  it('无 frontmatter 的纯正文也能解析', () => {
    const { fm, body } = parseFrontmatter('就是一段正文');
    expect(fm.title).toBe('untitled');
    expect(body).toBe('就是一段正文');
  });

  it('links 字段兼容裸 doc_id 形态', () => {
    const { fm } = parseFrontmatter('---\nlinks:\n  - doc_x1\n  - "[[doc_x2]]"\n---\n');
    expect(fm.links).toEqual(['[[doc_x1]]', '[[doc_x2]]']);
  });
});

describe('serializeFrontmatter → parseFrontmatter 往返', () => {
  it('中英文标题与来源数组 round-trip 无损', () => {
    const fm: DocFrontmatter = {
      id: 'doc_2026-09-12_001',
      type: 'archive',
      title: '归档：RAG 调研',
      source: [{ kind: 'feishu_doc', token: 't1', url: 'https://x.cn/docx/t1' }],
      tags: ['rag', '调研'],
      status: 'active',
      created_at: '2026-09-12T01:02:03.000Z',
      updated_at: '2026-09-12T01:02:03.000Z',
      links: ['[[doc_2026-09-11_001]]'],
    };
    const raw = serializeFrontmatter(fm, '# 归档：RAG 调研\n\n内容');
    const back = parseFrontmatter(raw);
    expect(back.fm).toEqual(fm);
    expect(back.body).toContain('RAG 调研');
  });

  it('空 source/tags/links 序列化时省略字段', () => {
    const raw = serializeFrontmatter(ensureDefaults({ id: 'd', title: 't' }), '正文');
    expect(raw).not.toContain('source:');
    expect(raw).not.toContain('tags:');
    expect(raw).not.toContain('links:');
    expect(raw).toContain('status: active');
  });
});

describe('normalizeTags', () => {
  it('字符串逗号串拆分 + trim + 小写 + 去重', () => {
    expect(normalizeTags('会议, 客户A , 会议')).toEqual(['会议', '客户a']);
  });
  it('数组去重', () => {
    expect(normalizeTags(['A', 'a', ' b '])).toEqual(['a', 'b']);
  });
  it('undefined / 空数组', () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags([])).toEqual([]);
  });
});
