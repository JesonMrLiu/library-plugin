// 工具层核心逻辑单测（write/read/list/delete；search 已在 search.test.ts 覆盖）

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeEnv } from './helper.js';
import { readDoc } from '../src/tools/read.js';
import { listDocs } from '../src/tools/list.js';
import { writeDoc } from '../src/tools/write.js';
import { deleteDoc } from '../src/tools/delete.js';
import { LibraryAuthError, LibraryNotFoundError } from '../src/errors.js';

/** 工具层测试默认开写 + 删（个别用例显式覆盖为 false） */
function wenv(envExtra: NodeJS.ProcessEnv = {}) {
  return makeEnv({ LIBRARY_ALLOW_WRITE: 'true', LIBRARY_ALLOW_DELETE: 'true', ...envExtra });
}

describe('writeDoc → readDoc → listDocs → deleteDoc 全链路', () => {
  it('write 双写：.md 文件 + sqlite 行 + FTS 可检索', () => {
    const env = wenv();
    const r = writeDoc(env, {
      type: 'summary',
      title: '知识库设计要点',
      content: 'trigram 分词器对中文子串召回友好',
      tags: ['RAG', '检索', 'RAG'],
    }) as { doc_id: string; path: string; tags: string[] };

    expect(r.doc_id).toMatch(/^doc_\d{4}-\d{2}-\d{2}_001$/);
    expect(r.tags).toEqual(['rag', '检索']); // 小写去重

    // .md 落盘且 frontmatter 可回读
    const md = readFileSync(join(env.root, 'docs', `${r.doc_id}.md`), 'utf8');
    expect(md).toContain(`id: ${r.doc_id}`);
    expect(md).toContain('title: 知识库设计要点');

    // sqlite 行 + FTS 命中（写入即索引，触发器同步）
    const row = env.storage.db.prepare('SELECT * FROM docs WHERE id = ?').get(r.doc_id) as {
      title: string; content: string;
    };
    expect(row.title).toBe('知识库设计要点');
    expect(row.content).toContain('trigram');

    const fts = env.storage.db
      .prepare(`SELECT d.id FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid WHERE docs_fts MATCH '分词器'`)
      .all() as { id: string }[];
    expect(fts.map((f) => f.id)).toContain(r.doc_id);
  });

  it('write source + links 入 frontmatter；指向已存在文档的 links 入 links 表', () => {
    const env = wenv();
    const a = writeDoc(env, {
      type: 'summary',
      title: 'A 文档',
      content: '第一篇',
    }) as { doc_id: string };

    const b = writeDoc(env, {
      type: 'summary',
      title: 'B 文档',
      content: '关联 [[A 文档]] 与不存在的话题',
      links: [a.doc_id],
    }) as { doc_id: string };

    const edges = env.storage.db
      .prepare('SELECT src_doc_id, dst_doc_id FROM links')
      .all() as { src_doc_id: string; dst_doc_id: string }[];
    // a.doc_id 在参数 links 里指向已存在的 A → 入表；正文 [[A 文档]] 不是合法 doc_id → 仅存 frontmatter
    expect(edges).toEqual([{ src_doc_id: b.doc_id, dst_doc_id: a.doc_id }]);
  });

  it('read 返回 frontmatter + 正文 + 合并双链', () => {
    const env = wenv();
    const a = writeDoc(env, { type: 'summary', title: '基础概念', content: '术语定义' }) as { doc_id: string };
    const b = writeDoc(env, {
      type: 'summary',
      title: '进阶笔记',
      content: `见 [[${a.doc_id}|概念篇]]`,
      links: [a.doc_id],
    }) as { doc_id: string };

    const r = readDoc(env, b.doc_id);
    expect(r.doc_id).toBe(b.doc_id);
    expect(r.content).toContain('概念篇');
    expect(r.links).toContain(a.doc_id);
    expect((r.source as unknown[]).length).toBe(0);
  });

  it('read 不存在的 doc_id → DOC_NOT_FOUND', () => {
    const env = wenv();
    expect(() => readDoc(env, 'doc_1999-01-01_999')).toThrow(LibraryNotFoundError);
  });

  it('listDocs 过滤：默认排除 deleted；type/tags/status 过滤生效', () => {
    const env = wenv();
    const a = writeDoc(env, { type: 'summary', title: '活跃笔记', content: 'x', tags: ['算法'] }) as { doc_id: string };
    writeDoc(env, { type: 'archive', title: '归档文档', content: 'y', tags: ['算法'] });
    const d = writeDoc(env, { type: 'summary', title: '待删', content: 'z' }) as { doc_id: string };

    const all = listDocs(env, {}) as { items: { doc_id: string; type: string }[] };
    expect(all.total).toBe(3);

    const archived = listDocs(env, { type: 'archive' }) as { items: { doc_id: string }[] };
    expect(archived.total).toBe(1);

    const tagged = listDocs(env, { tags: ['算法'] }) as { items: { doc_id: string }[] };
    expect(tagged.total).toBe(2);

    deleteDoc(env, d.doc_id);
    const afterDelete = listDocs(env, {}) as { items: { doc_id: string }[] };
    expect(afterDelete.items.map((i) => i.doc_id)).not.toContain(d.doc_id);
    expect(afterDelete.items.map((i) => i.doc_id)).toContain(a.doc_id);

    const onlyDeleted = listDocs(env, { status: 'deleted' }) as { items: { doc_id: string }[] };
    expect(onlyDeleted.items.map((i) => i.doc_id)).toEqual([d.doc_id]);
  });

  it('listDocs limit 截断', () => {
    const env = wenv();
    writeDoc(env, { type: 'summary', title: '一', content: 'x' });
    writeDoc(env, { type: 'summary', title: '二', content: 'x' });
    writeDoc(env, { type: 'summary', title: '三', content: 'x' });
    const r = listDocs(env, { limit: 2 }) as { total: number };
    expect(r.total).toBe(2);
  });

  it('deleteDoc 软删除：sqlite status + .md frontmatter 同步；重复删除幂等', () => {
    const env = wenv();
    const w = writeDoc(env, { type: 'summary', title: '旧笔记', content: '待删除内容' }) as { doc_id: string; path: string };

    const r1 = deleteDoc(env, w.doc_id) as { deleted: boolean; mode: string };
    expect(r1.deleted).toBe(true);
    expect(r1.mode).toBe('soft');

    // sqlite
    const row = env.storage.db.prepare('SELECT status FROM docs WHERE id = ?').get(w.doc_id) as { status: string };
    expect(row.status).toBe('deleted');

    // .md frontmatter
    const md = readFileSync(w.path, 'utf8');
    expect(md).toContain('status: deleted');

    // 幂等
    const r2 = deleteDoc(env, w.doc_id) as { deleted: boolean; already: boolean };
    expect(r2.already).toBe(true);

    // 软删除后 search 默认不召回
    const hits = env.storage.db
      .prepare(`SELECT d.id FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid
                WHERE docs_fts MATCH '待删除' AND d.status = 'active'`)
      .all();
    expect(hits).toEqual([]);
  });

  it('deleteDoc 不存在 → DOC_NOT_FOUND', () => {
    const env = wenv();
    expect(() => deleteDoc(env, 'doc_1999-01-01_999')).toThrow(LibraryNotFoundError);
  });

  it('只读模式下 writeDoc 抛 READONLY_MODE', () => {
    const env = wenv({ LIBRARY_ALLOW_WRITE: 'false' });
    expect(() =>
      writeDoc(env, { type: 'summary', title: 'x', content: 'y' }),
    ).toThrow(LibraryAuthError);
  });

  it('ALLOW_DELETE 关闭时 deleteDoc 抛 DELETE_DISABLED', () => {
    const env = wenv({ LIBRARY_ALLOW_DELETE: 'false' });
    const w = writeDoc(env, { type: 'summary', title: 'x', content: 'y' }) as { doc_id: string };
    expect(() => deleteDoc(env, w.doc_id)).toThrow(LibraryAuthError);
  });
});
