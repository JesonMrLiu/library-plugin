// env 解析 + zod 校验 → 强类型 Config
//
// 约定：空字符串按未设置处理（插件的 ${VAR} 插值在用户 env 缺失时会传空串）。
// LIBRARY_ROOT 不强制存在——启动期 storage.init 会自动创建（决策 #2）。

import { z } from 'zod';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

const bool = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v === 'true'));

const num = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : Number(v)));

const EnvSchema = z.object({
  LIBRARY_ROOT: z.string().optional(),
  LIBRARY_DOCS_SUBDIR: z.string().optional(),
  LIBRARY_METADATA_DIR: z.string().optional(),
  LIBRARY_SQLITE_NAME: z.string().optional(),
  LIBRARY_ALLOW_WRITE: bool,
  LIBRARY_ALLOW_DELETE: bool,
  LIBRARY_SEARCH_DEFAULT_TOPK: num,
  LIBRARY_LIST_DEFAULT_LIMIT: num,
  LIBRARY_LOG_LEVEL: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 'info' : v))
    .pipe(z.enum(['debug', 'info', 'warn', 'error'])),
  LIBRARY_ID_PREFIX: z.string().optional(),
});

export interface Config {
  /** 知识库根目录（绝对路径） */
  root: string;
  docsSubdir: string;
  metadataDir: string;
  sqliteName: string;
  allowWrite: boolean;
  allowDelete: boolean;
  searchDefaultTopK: number;
  listDefaultLimit: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  idPrefix: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env); // env 全有默认值，parse 不会失败

  const rawRoot = e.LIBRARY_ROOT && e.LIBRARY_ROOT.trim() ? e.LIBRARY_ROOT : resolve(homedir(), 'library');
  const root = isAbsolute(rawRoot) ? rawRoot : resolve(rawRoot);

  const config: Config = {
    root,
    docsSubdir: e.LIBRARY_DOCS_SUBDIR || 'docs',
    metadataDir: e.LIBRARY_METADATA_DIR || '.library',
    sqliteName: e.LIBRARY_SQLITE_NAME || 'library.sqlite',
    allowWrite: e.LIBRARY_ALLOW_WRITE ?? false,
    allowDelete: e.LIBRARY_ALLOW_DELETE ?? false,
    searchDefaultTopK: e.LIBRARY_SEARCH_DEFAULT_TOPK ?? 5,
    listDefaultLimit: e.LIBRARY_LIST_DEFAULT_LIMIT ?? 20,
    logLevel: e.LIBRARY_LOG_LEVEL,
    idPrefix: e.LIBRARY_ID_PREFIX || 'doc_',
  };

  if (config.allowDelete && !config.allowWrite) {
    console.error(
      '[library-mcp] ⚠ LIBRARY_ALLOW_DELETE=true 但 LIBRARY_ALLOW_WRITE 未开启，delete 工具不会注册',
    );
  }
  return config;
}

/** 日志（stderr；stdout 只给 JSON-RPC） */
export function log(config: Config, level: 'debug' | 'info' | 'warn' | 'error', msg: string): void {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  if (order[level] >= order[config.logLevel]) {
    console.error(`[library-mcp] ${level === 'error' ? '✖' : level === 'warn' ? '⚠' : '·'} ${msg}`);
  }
}
