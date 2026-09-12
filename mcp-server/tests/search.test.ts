// FTS5 trigram 检索单测：中文召回是核心验证目标（决策 #3）

import { describe, expect, it } from 'vitest';
import { buildMatchExpr, cleanFtsChars, searchDocs, splitTokens } from '../src/search.js';
import { LibraryError } from '../src/errors.js';
import { makeEnv, seedDoc, type TestEnv } from './helper.js';

function setup(): TestEnv {
  const env = makeEnv();
  seedDoc(env, { id: 'd1', title: 'RAG 检索增强生成', content: '关于 embedding 检索与重排的技术调研，召回率是关键指标' });
  seedDoc(env, { id: 'd2', title: '知识库设计', content: '个人知识库的存储格式与 trigram 分词器选型' });
  seedDoc(env, { id: 'd3', title: '向量检索', content: 'embedding 与 cosine 相似度计算' });
  seedDoc(env, { id: 'd4', title: '周会记录', content: '客户 A 项目排期讨论', tags: ['会议'] });
  seedDoc(env, { id: 'd5', title: '已删除的草稿', content: '知识库知识库知识库', status: 'deleted' });
  seedDoc(env, { id: 'd6', title: '归档文档', content: '旧知识库方案归档', type: 'archive' });
  return env;
}

describe('纯函数', () => {
  it('cleanFtsChars 剥离 FTS5 保留字符', () => {
    expect(cleanFtsChars('test"foo\'bar(baz)*:^')).toBe('test foo bar baz');
    expect(cleanFtsChars('   ')).toBe('');
  });

  it('splitTokens：≥3 字符走 FTS，<3 走 LIKE', () => {
    const r = splitTokens('trigram 分词器 检索');
    expect(r.longTokens).toEqual(['trigram', '分词器']);
    expect(r.shortTokens).toEqual(['检索']);
  });

  it('buildMatchExpr 多 phrase AND', () => {
    expect(buildMatchExpr(['a123', '中文词'])).toBe('"a123" AND "中文词"');
  });
});

describe('searchDocs — trigram 中文召回', () => {
  it('中文 ≥3 字精确命中', () => {
    const env = setup();
    const r = searchDocs(env.storage.db, '知识库设计');
    expect(r[0]?.id).toBe('d2');
  });

  it('中文子串召回（trigram 优势）', () => {
    const env = setup();
    // "检索增强" 是 d1 标题 "RAG 检索增强生成" 的子串
    const r = searchDocs(env.storage.db, '检索增强');
    expect(r.map((h) => h.id)).toContain('d1');
  });

  it('2 字中文词走 LIKE 兜底命中', () => {
    const env = setup();
    const r = searchDocs(env.storage.db, '排期');
    expect(r.map((h) => h.id)).toContain('d4');
    expect(r[0]?.snippet).toContain('⟨排期⟩');
  });

  it('英文 token 与中文混合 AND 召回', () => {
    const env = setup();
    const r = searchDocs(env.storage.db, 'embedding 检索');
    expect(r.map((h) => h.id)).toContain('d1');
    expect(r.map((h) => h.id)).toContain('d3'); // embedding 命中 d3
  });

  it('软删除文档不参与召回', () => {
    const env = setup();
    const r = searchDocs(env.storage.db, '知识库知识库');
    expect(r.map((h) => h.id)).not.toContain('d5');
  });

  it('type=archive 过滤', () => {
    const env = setup();
    const r = searchDocs(env.storage.db, '知识库方案', { type: 'archive' });
    expect(r.map((h) => h.id)).toEqual(['d6']);
  });

  it('tags 过滤', () => {
    const env = setup();
    const r = searchDocs(env.storage.db, '讨论', { tags: ['会议'] });
    expect(r.map((h) => h.id)).toEqual(['d4']);
  });

  it('topK 截断', () => {
    const env = setup();
    const r = searchDocs(env.storage.db, 'embedding', { topK: 1 });
    expect(r.length).toBeLessThanOrEqual(1);
  });

  it('空查询 → LibraryError EMPTY_QUERY', () => {
    const env = setup();
    expect(() => searchDocs(env.storage.db, '   ')).toThrow(LibraryError);
    expect(() => searchDocs(env.storage.db, '""\'\'')).toThrow(LibraryError);
  });

  it('0 命中返回空数组（不抛错）', () => {
    const env = setup();
    expect(searchDocs(env.storage.db, '不存在的内容xyzq')).toEqual([]);
  });

  it('snippet 含命中上下文', () => {
    const env = setup();
    const r = searchDocs(env.storage.db, '分词器选型');
    expect(r[0]?.snippet.length).toBeGreaterThan(0);
  });
});
