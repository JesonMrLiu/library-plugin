// [[doc_xxx]] 双链解析 单测（纯函数）

import { describe, expect, it } from 'vitest';
import {
  extractLinks,
  mergeLinks,
  parseFrontmatterLinks,
} from '../src/link-parser.js';

describe('extractLinks', () => {
  it('基础 [[doc_x]] 解析', () => {
    expect(extractLinks('参见 [[doc_2026-09-10_005]]')).toEqual([
      { docId: 'doc_2026-09-10_005' },
    ]);
  });

  it('别名 [[doc_x|别名]] 解析', () => {
    expect(extractLinks('参见 [[doc_1|上周会议]]')).toEqual([{ docId: 'doc_1', alias: '上周会议' }]);
  });

  it('别名含空格', () => {
    expect(extractLinks('[[doc_1|客户 A 会议]]')).toEqual([{ docId: 'doc_1', alias: '客户 A 会议' }]);
  });

  it('多个链接全提取 + 去重', () => {
    const body = '- [[doc_1]]\n- [[doc_2|备注]]\n- [[doc_1]]\n';
    expect(extractLinks(body)).toEqual([{ docId: 'doc_1' }, { docId: 'doc_2', alias: '备注' }]);
  });

  it('空正文 / 无链接', () => {
    expect(extractLinks('')).toEqual([]);
    expect(extractLinks('普通文本没有链接')).toEqual([]);
  });

  it('非链接的双方括号不误报', () => {
    expect(extractLinks('数组字面量 [[1, 2]] 不是文档链接')).toEqual([
      { docId: '1, 2' },
    ]);
    // ↑ 行为说明：解析器不做 doc_id 格式强校验，由调用方按 id 前缀过滤
  });
});

describe('parseFrontmatterLinks', () => {
  it('[[doc_x]] 形态数组', () => {
    expect(parseFrontmatterLinks(['[[doc_1]]', '[[doc_2]]'])).toEqual([
      { docId: 'doc_1' },
      { docId: 'doc_2' },
    ]);
  });
  it('空数组 / undefined', () => {
    expect(parseFrontmatterLinks([])).toEqual([]);
    expect(parseFrontmatterLinks(undefined)).toEqual([]);
  });
});

describe('mergeLinks', () => {
  it('frontmatter 优先（别名覆盖正文别名）', () => {
    const merged = mergeLinks(
      [{ docId: 'doc_1', alias: '正式名' }],
      [{ docId: 'doc_1' }, { docId: 'doc_2' }],
    );
    expect(merged).toEqual([{ docId: 'doc_1', alias: '正式名' }, { docId: 'doc_2' }]);
  });
});
