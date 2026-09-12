// doc_id 生成器单测

import { describe, expect, it } from 'vitest';
import { currentDailySeq, DAILY_SEQ_LIMIT, generateDocId } from '../src/id.js';
import { LibraryError } from '../src/errors.js';
import { makeEnv } from './helper.js';

describe('generateDocId', () => {
  it('首次生成 → _001', () => {
    const { storage } = makeEnv();
    expect(generateDocId(storage.db, 'doc_', '2026-09-12')).toBe('doc_2026-09-12_001');
  });

  it('同日递增', () => {
    const { storage } = makeEnv();
    generateDocId(storage.db, 'doc_', '2026-09-12');
    generateDocId(storage.db, 'doc_', '2026-09-12');
    expect(generateDocId(storage.db, 'doc_', '2026-09-12')).toBe('doc_2026-09-12_003');
  });

  it('隔日重置为 _001', () => {
    const { storage } = makeEnv();
    generateDocId(storage.db, 'doc_', '2026-09-12');
    generateDocId(storage.db, 'doc_', '2026-09-12');
    expect(generateDocId(storage.db, 'doc_', '2026-09-13')).toBe('doc_2026-09-13_001');
  });

  it('序号零填充到三位（>99 时）', () => {
    const { storage } = makeEnv();
    for (let i = 0; i < 99; i++) generateDocId(storage.db, 'doc_', '2026-09-12');
    expect(generateDocId(storage.db, 'doc_', '2026-09-12')).toBe('doc_2026-09-12_100');
  });

  it('自定义前缀', () => {
    const { storage } = makeEnv();
    expect(generateDocId(storage.db, 'note_', '2026-09-12')).toBe('note_2026-09-12_001');
  });

  it('连续生成 999 次无重复；第 1000 次抛 DAILY_LIMIT', () => {
    const { storage } = makeEnv();
    const ids = new Set<string>();
    for (let i = 0; i < DAILY_SEQ_LIMIT; i++) {
      ids.add(generateDocId(storage.db, 'doc_', '2026-09-12'));
    }
    expect(ids.size).toBe(DAILY_SEQ_LIMIT);
    expect(() => generateDocId(storage.db, 'doc_', '2026-09-12')).toThrow(LibraryError);
    // 隔日不受影响
    expect(generateDocId(storage.db, 'doc_', '2026-09-13')).toBe('doc_2026-09-13_001');
  });

  it('计数器读侧一致', () => {
    const { storage } = makeEnv();
    expect(currentDailySeq(storage.db, '2026-09-12')).toBe(0);
    generateDocId(storage.db, 'doc_', '2026-09-12');
    expect(currentDailySeq(storage.db, '2026-09-12')).toBe(1);
  });
});
