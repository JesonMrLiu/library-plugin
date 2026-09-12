// doc_id 生成：sqlite meta 表原子计数（决策见设计文档 §7 的 id 格式）
//
// 形态：{prefix}{YYYY-MM-DD}_{NNN}，如 doc_2026-09-12_001
// 计数器：meta 表 key = `doc_seq:${dateKey}`，value = 三位零填充序号
// 并发安全：better-sqlite3 同步 API + BEGIN IMMEDIATE 事务（多进程写也安全）

import type { Database } from 'better-sqlite3';
import { LibraryError } from './errors.js';

export const DAILY_SEQ_LIMIT = 999;

/**
 * 生成下一个 doc_id（事务内原子自增）。
 * @param dateKey 'YYYY-MM-DD'（注入以便测试）
 */
export function generateDocId(db: Database, idPrefix: string, dateKey: string): string {
  const metaKey = `doc_seq:${dateKey}`;

  const tx = db.transaction((): string => {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(metaKey) as
      | { value: string }
      | undefined;
    const current = row ? parseInt(row.value, 10) || 0 : 0;

    if (current >= DAILY_SEQ_LIMIT) {
      throw new LibraryError(
        'DAILY_LIMIT',
        `当日 (${dateKey}) doc_id 序号已达上限 ${DAILY_SEQ_LIMIT}，多为异常写入循环`,
      );
    }

    const next = current + 1;
    db.prepare(
      'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(metaKey, String(next).padStart(3, '0'));

    return `${idPrefix}${dateKey}_${String(next).padStart(3, '0')}`;
  });

  return tx.immediate();
}

/** 当日已用序号（读侧，不自增） */
export function currentDailySeq(db: Database, dateKey: string): number {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(`doc_seq:${dateKey}`) as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) || 0 : 0;
}
