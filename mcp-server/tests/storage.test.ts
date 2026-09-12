// storage 单测：auto-init / 原子写 / 损坏恢复 / 触发器同步

import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { LibraryInitError } from '../src/errors.js';
import { Storage } from '../src/storage.js';
import { makeEnv } from './helper.js';

describe('Storage.init（auto-init，决策 #2）', () => {
  it('LIBRARY_ROOT 不存在 → 自动创建 root/docs/.library + sqlite schema', () => {
    const { root, storage } = makeEnv();
    expect(existsSync(root)).toBe(true);
    expect(existsSync(storage.docsDir)).toBe(true);
    expect(existsSync(storage.metaDir)).toBe(true);
    expect(existsSync(storage.sqlitePath)).toBe(true);

    // schema 全部就位
    const tables = storage.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('docs');
    expect(names).toContain('docs_fts');
    expect(names).toContain('links');
    expect(names).toContain('meta');
  });

  it('重复 init 幂等（不报错不丢数据）', () => {
    const { storage } = makeEnv();
    expect(() => storage.init()).not.toThrow();
  });

  it('FTS5 trigram 分词器生效', () => {
    const { storage } = makeEnv();
    const sql = storage.db
      .prepare("SELECT sql FROM sqlite_master WHERE name='docs_fts'")
      .get() as { sql: string };
    expect(sql.sql).toContain("tokenize='trigram'");
  });

  it('LIBRARY_ROOT 路径被文件占位 → LibraryInitError', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'library-mcp-badroot-')), 'occupied');
    writeFileSync(root, 'i am a file not a dir', 'utf8');
    const config = loadConfig({ LIBRARY_ROOT: root });
    const storage = new Storage(config);
    expect(() => storage.init()).toThrow(LibraryInitError);
  });
});

describe('writeDocAtomic 原子写', () => {
  it('.tmp + rename：写入后无 .tmp 残留，内容完整', () => {
    const { storage } = makeEnv();
    const p = join(storage.docsDir, 'doc_x.md');
    storage.writeDocAtomic(p, '# 标题\n\n中文内容');
    expect(existsSync(`${p}.tmp`)).toBe(false);
    expect(readFileSync(p, 'utf8')).toBe('# 标题\n\n中文内容');
  });

  it('目标子目录不存在时自动创建', () => {
    const { storage } = makeEnv();
    const p = join(storage.docsDir, 'sub', 'nested', 'doc_y.md');
    storage.writeDocAtomic(p, '内容');
    expect(existsSync(p)).toBe(true);
  });
});

describe('sqlite 损坏恢复', () => {
  it('非法 sqlite 文件 → 备份 .corrupt-<ts> 后重建可用', () => {
    const env = makeEnv();
    const corruptPath = env.storage.sqlitePath;
    env.storage.close();

    // 用垃圾内容覆盖模拟损坏
    writeFileSync(corruptPath, 'this is not a sqlite file at all', 'utf8');

    const s2 = new Storage(env.config);
    expect(() => s2.init()).not.toThrow();
    expect(s2.db.prepare('SELECT COUNT(*) AS c FROM docs').get()).toEqual({ c: 0 });

    // 备份文件存在
    const metaFiles = readdirSync(env.storage.metaDir);
    expect(metaFiles.some((f) => f.includes('.corrupt-'))).toBe(true);
    s2.close();
  });
});

describe('FTS 索引同步（触发器）', () => {
  it('INSERT / UPDATE / DELETE 三触发器保持 docs_fts 与 docs 一致', () => {
    const { storage } = makeEnv();
    const now = new Date().toISOString();
    const ins = storage.db.prepare(
      `INSERT INTO docs (id, type, path, title, content, tags, status, created_at, updated_at)
       VALUES (?, 'summary', ?, ?, ?, ?, 'active', ?, ?)`,
    );
    ins.run('doc_a', 'a.md', '知识库设计', '关于个人知识库的设计文档', '["设计"]', now, now);
    ins.run('doc_b', 'b.md', 'RAG 调研', '检索增强生成技术调研', '["rag"]', now, now);

    const count = (expr: string) =>
      (
        storage.db
          .prepare(
            `SELECT COUNT(*) AS c FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid WHERE docs_fts MATCH ?`,
          )
          .get(expr) as { c: number }
      ).c;

    expect(count('"知识库设计"')).toBe(1);
    expect(count('"检索增强"')).toBe(1);

    // UPDATE：旧索引条目必须被 'delete' 命令清掉
    storage.db
      .prepare('UPDATE docs SET title = ?, content = ? WHERE id = ?')
      .run('更名后的标题', '完全不同的新内容', 'doc_a');
    expect(count('"知识库设计"')).toBe(0);
    expect(count('"更名后的标题"')).toBe(1);
    expect(count('"完全不同的新内容"')).toBe(1);

    // DELETE
    storage.db.prepare('DELETE FROM docs WHERE id = ?').run('doc_b');
    expect(count('"检索增强"')).toBe(0);
  });
});
