// 测试共享工具：临时 LIBRARY_ROOT + Storage 实例 + 示例文档写入
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import type { Config } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { Storage } from '../src/storage.js';

export interface TestEnv {
  root: string;
  storage: Storage;
  config: Config;
  cleanup: () => void;
}

const cleanups: Array<() => void> = [];

/** 每个用例独立临时目录 + 已 init 的 Storage */
export function makeEnv(envExtra: NodeJS.ProcessEnv = {}): TestEnv {
  const root = mkdtempSync(join(tmpdir(), 'library-mcp-test-'));
  const config = loadConfig({
    // vitest 进程 env 里可能有干扰，仅保留白名单
    PATH: process.env.PATH ?? '',
    LIBRARY_ROOT: root,
    ...envExtra,
  });
  const storage = new Storage(config);
  storage.init();
  const cleanup = () => {
    try {
      storage.close();
    } catch {
      /* 已关闭 */
    }
    // Windows 下 sqlite 句柄释放有延迟，rmSync 可能 EPERM——重试几次
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(root, { recursive: true, force: true });
        return;
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); // 同步 sleep
      }
    }
  };
  cleanups.push(cleanup);
  return { root, storage, config, cleanup };
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/** 写一篇文档（.md + sqlite 双写），返回 doc_id */
export function seedDoc(
  env: TestEnv,
  fm: {
    id: string;
    title: string;
    content: string;
    type?: 'summary' | 'archive';
    tags?: string[];
    status?: 'active' | 'draft' | 'deleted';
  },
): string {
  const { storage } = env;
  const now = new Date().toISOString();
  const path = join(storage.docsDir, `${fm.id}.md`);
  const frontmatter = [
    '---',
    `id: ${fm.id}`,
    `type: ${fm.type ?? 'summary'}`,
    `title: "${fm.title.replace(/"/g, "'")}"`,
    fm.tags?.length ? `tags: ${JSON.stringify(fm.tags)}` : null,
    `status: ${fm.status ?? 'active'}`,
    `created_at: ${now}`,
    `updated_at: ${now}`,
    '---',
    '',
  ]
    .filter((l) => l !== null)
    .join('\n');
  storage.writeDocAtomic(path, `${frontmatter}${fm.content}\n`);
  storage.db
    .prepare(
      `INSERT INTO docs (id, type, path, title, content, tags, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fm.id,
      fm.type ?? 'summary',
      path,
      fm.title,
      fm.content,
      fm.tags ? JSON.stringify(fm.tags) : null,
      fm.status ?? 'active',
      now,
      now,
    );
  return fm.id;
}
