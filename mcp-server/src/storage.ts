// 存储层：sqlite 单例 + .md 原子读写 + 启动期 auto-init
//
// 数据布局（LIBRARY_ROOT 下）：
//   docs/*.md           笔记正文（真相存储——手工可直接编辑）
//   .library/library.sqlite   索引 + 元数据（可随时删掉重建，MVP 期启动 rebuild）
//
// FTS5 采用 trigram 分词（决策 #3）：中文子串召回好。
// 外部内容表（content='docs'）的触发器必须用 SQLite 官方推荐的
// 'delete' 命令模式同步，直接 UPDATE docs_fts 会导致索引脏数据。

import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Config } from './config.js';
import { LibraryInitError } from './errors.js';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS docs (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('summary','archive')),
  path        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  source      TEXT,
  tags        TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK(status IN ('active','draft','deleted')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_updated_at ON docs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_type ON docs(type);

CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  title, content, tags,
  content='docs', content_rowid='rowid',
  tokenize='trigram'
);

-- 官方推荐的外部内容表同步触发器（INSERT / 'delete' 模式）
CREATE TRIGGER IF NOT EXISTS docs_fts_ai AFTER INSERT ON docs BEGIN
  INSERT INTO docs_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS docs_fts_ad AFTER DELETE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS docs_fts_au AFTER UPDATE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
  INSERT INTO docs_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;

CREATE TABLE IF NOT EXISTS links (
  src_doc_id  TEXT NOT NULL,
  dst_doc_id  TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'related'
              CHECK(kind IN ('related','cites','supersedes')),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (src_doc_id, dst_doc_id, kind),
  FOREIGN KEY (src_doc_id) REFERENCES docs(id) ON DELETE CASCADE,
  FOREIGN KEY (dst_doc_id) REFERENCES docs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_links_dst ON links(dst_doc_id);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export class Storage {
  readonly root: string;
  readonly docsDir: string;
  readonly metaDir: string;
  readonly sqlitePath: string;
  private _db: Database.Database | undefined;

  constructor(config: Config) {
    this.root = config.root;
    this.docsDir = join(config.root, config.docsSubdir);
    this.metaDir = join(config.root, config.metadataDir);
    this.sqlitePath = join(this.metaDir, config.sqliteName);
  }

  /** sqlite 连接（init 之后可用；工具层只读这一个实例） */
  get db(): Database.Database {
    if (!this._db) throw new LibraryInitError('INIT_FAILED', 'storage.init() 尚未调用');
    return this._db;
  }

  /**
   * 启动期自动初始化（决策 #2）：
   * 建 root/docs/.library 目录 → 校验可写 → 打开（或重建损坏的）sqlite → 建表 → FTS rebuild。
   * 致命错误（目录不可写 / sqlite 打不开且无法备份重建）抛 LibraryInitError，由入口 exit 1。
   */
  init(): void {
    this.ensureRoot();
    this.assertWritable();

    if (existsSync(this.sqlitePath)) {
      this.openExistingOrRecover();
    } else {
      this._db = this.openDb();
    }

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
    // 防索引漂移：MVP 期每次启动全量重建（个人库规模小，代价可接受）
    this.db.exec(`INSERT INTO docs_fts(docs_fts) VALUES ('rebuild')`);

    this.warnIfUnindexedMarkdown();
  }

  close(): void {
    this._db?.close();
    this._db = undefined;
  }

  /** 原子写 .md：先写 .tmp 再 rename，避免半写文件 */
  writeDocAtomic(absPath: string, content: string): void {
    mkdirSync(dirname(absPath), { recursive: true });
    const tmp = `${absPath}.tmp`;
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, absPath);
  }

  readDoc(absPath: string): string {
    return readFileSync(absPath, 'utf8');
  }

  /** docs/ 下所有 .md 的绝对路径（按文件名排序） */
  docFiles(): string[] {
    if (!existsSync(this.docsDir)) return [];
    return readdirSync(this.docsDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => join(this.docsDir, f));
  }

  // ---- 内部 ----

  private ensureRoot(): void {
    try {
      mkdirSync(this.root, { recursive: true });
      mkdirSync(this.docsDir, { recursive: true });
      mkdirSync(this.metaDir, { recursive: true });
    } catch (e) {
      throw new LibraryInitError(
        'INIT_FAILED',
        `无法创建 LIBRARY_ROOT 目录结构: ${this.root} (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  }

  private assertWritable(): void {
    const probe = join(this.root, '.library-write-probe');
    try {
      writeFileSync(probe, 'ok', 'utf8');
      unlinkSync(probe);
    } catch (e) {
      throw new LibraryInitError(
        'ROOT_UNWRITABLE',
        `LIBRARY_ROOT 不可写: ${this.root} (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  }

  /** 打开已存在的 sqlite；打不开 / 完整性检查失败 → 备份为 .corrupt-<ts> 后重建 */
  private openExistingOrRecover(): void {
    let db: Database.Database | undefined;
    try {
      db = this.openDb();
      const check = db.pragma('integrity_check') as { integrity_check: string }[];
      if (check[0]?.integrity_check === 'ok') {
        this._db = db;
        return;
      }
      db.close();
      this.recoverCorrupted();
    } catch {
      // 文件存在但不是合法 sqlite（SQLITE_NOTADB / exec schema 失败）→ 关句柄后备份重建
      // Windows 下必须先 close 才能 rename，否则 EPERM
      try {
        db?.close();
      } catch {
        /* 已关闭 */
      }
      this.recoverCorrupted();
    }
  }

  private recoverCorrupted(): void {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${this.sqlitePath}.corrupt-${ts}`;
    // Windows 下句柄释放有延迟（尤其构造器抛错场景由 GC 决定），EBUSY 需重试
    let lastErr: unknown;
    for (let i = 0; i < 20; i++) {
      try {
        renameSync(this.sqlitePath, backup);
        console.error(`[library-mcp] ⚠ sqlite 损坏，已备份为 ${backup} 并重建（docs/*.md 为真相，可无损重建）`);
        this._db = this.openDb();
        return;
      } catch (e) {
        lastErr = e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); // 同步 sleep
      }
    }
    throw new LibraryInitError(
      'SQLITE_CORRUPT',
      `sqlite 损坏且无法备份: ${this.sqlitePath} (${lastErr instanceof Error ? lastErr.message : String(lastErr)})`,
    );
  }

  private openDb(): Database.Database {
    const db = new Database(this.sqlitePath);
    try {
      db.exec(SCHEMA_SQL); // 打开即确保 schema 存在（也覆盖新建场景）
    } catch (e) {
      // 垃圾文件上 exec 会抛错——必须先 close 再抛，否则 Windows 句柄泄漏导致后续 rename EBUSY
      try {
        db.close();
      } catch {
        /* 已关闭 */
      }
      throw e;
    }
    return db;
  }

  /** docs/ 有 .md 但 docs 表为空 → stderr 提示（不自动反向重建，留 V1 的 rebuild_index） */
  private warnIfUnindexedMarkdown(): void {
    const files = this.docFiles();
    if (!files.length) return;
    const count = (this.db.prepare('SELECT COUNT(*) AS c FROM docs').get() as { c: number }).c;
    if (count === 0) {
      console.error(
        `[library-mcp] ⚠ docs/ 下有 ${files.length} 个 .md 但索引为空（可能是手工放入）。` +
          '目前不会自动反向索引；如需纳入检索，重新写入或等待 V1 的 rebuild_index 工具',
      );
    }
  }
}

/** 便捷工厂：临时目录场景（测试用） */
export function makeTestStorage(root: string, config: Config): Storage {
  return new Storage({ ...config, root: resolve(root) });
}
