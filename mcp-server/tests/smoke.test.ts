// 协议层冒烟测试：spawn dist 产物，喂 stdio JSON-RPC，验证启动期 auto-init + 工具开关
// 运行前需 npm run build

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const distIndex = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

interface RpcClient {
  child: ChildProcess;
  request: <T = any>(method: string, params?: unknown) => Promise<T>;
  close: () => Promise<void>;
}

function startServer(envOverrides: Record<string, string>): Promise<RpcClient> {
  // 每个服务器实例独立 LIBRARY_ROOT（临时目录），避免污染真实 ~/library
  const root = mkdtempSync(join(tmpdir(), 'library-mcp-smoke-'));
  const child = spawn(process.execPath, [distIndex], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LIBRARY_ROOT: root, ...envOverrides },
  });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  let buf = '';

  child.stdout!.on('data', (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)![msg.error ? 'reject' : 'resolve'](msg.error ?? msg.result);
        pending.delete(msg.id);
      }
    }
  });
  child.stderr!.on('data', () => {}); // 吞掉启动日志，避免测试输出噪音

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server 启动超时')), 10000);
    child.on('spawn', () => {
      clearTimeout(timeout);
      resolve({
        child,
        request: <T>(method: string, params?: unknown) =>
          new Promise<T>((res, rej) => {
            const id = nextId++;
            pending.set(id, { resolve: res, reject: rej });
            (child.stdin as NonNullable<ChildProcess['stdin']>).write(
              JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
            );
          }),
        close: () =>
          new Promise<void>((res) => {
            child.kill();
            child.on('exit', () => res());
          }),
      });
    });
    child.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}

async function init(rpc: RpcClient): Promise<void> {
  await rpc.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0' },
  });
}

describe('smoke（协议层，需先 build）', () => {
  beforeAll(() => {
    if (!existsSync(distIndex)) {
      throw new Error(`dist/index.js 不存在：先运行 npm run build（${distIndex}）`);
    }
  });

  describe('只读模式（默认 env）+ 启动期 auto-init', () => {
    let rpc: RpcClient;
    beforeAll(async () => {
      rpc = await startServer({});
      await init(rpc);
    });
    afterAll(() => rpc?.close());

    it('ping', async () => {
      const pong = await rpc.request('ping');
      expect(pong).toEqual({});
    });

    it('tools/list 恰好 3 个只读工具', async () => {
      const res = await rpc.request<{ tools: { name: string }[] }>('tools/list');
      const names = res.tools.map((t) => t.name).sort();
      expect(names).toEqual(['list', 'read', 'search']);
    });

    it('只读模式不含 write/delete', async () => {
      const res = await rpc.request<{ tools: { name: string }[] }>('tools/list');
      const names = res.tools.map((t) => t.name);
      expect(names).not.toContain('write');
      expect(names).not.toContain('delete');
    });

    it('search 的 description 提及中文子串召回（模型需知道 trigram 特性）', async () => {
      const res = await rpc.request<{ tools: { name: string; description: string }[] }>('tools/list');
      const tool = res.tools.find((t) => t.name === 'search')!;
      expect(tool.description).toContain('trigram');
    });

    it('read 不存在的 doc_id → isError 且含 DOC_NOT_FOUND 提示', async () => {
      const res = await rpc.request<{ content: { text: string }[]; isError?: boolean }>('tools/call', {
        name: 'read',
        arguments: { doc_id: 'doc_1999-01-01_999' },
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('doc_1999-01-01_999');
    });
  });

  describe('写开启 + 删除开启：auto-init + 全工具 + 端到端写读搜删', () => {
    let rpc: RpcClient;
    beforeAll(async () => {
      rpc = await startServer({ LIBRARY_ALLOW_WRITE: 'true', LIBRARY_ALLOW_DELETE: 'true' });
      await init(rpc);
    });
    afterAll(() => rpc?.close());

    it('tools/list 共 5 个工具', async () => {
      const res = await rpc.request<{ tools: { name: string }[] }>('tools/list');
      expect(res.tools.map((t) => t.name).sort()).toEqual(['delete', 'list', 'read', 'search', 'write']);
    });

    it('write → 端到端：返回 doc_id；search 召回；read 全文；delete 软删', async () => {
      // write
      const w = await rpc.request<{ content: { text: string }[]; isError?: boolean }>('tools/call', {
        name: 'write',
        arguments: {
          type: 'summary',
          title: '知识库冒烟测试',
          content: '这是一篇通过 MCP 协议写入的中文检索测试文档',
          tags: ['smoke'],
        },
      });
      expect(w.isError).toBeUndefined();
      const wData = JSON.parse(w.content[0].text) as { doc_id: string };
      expect(wData.doc_id).toMatch(/^doc_\d{4}-\d{2}-\d{2}_001$/);

      // search（trigram 中文召回）
      const s = await rpc.request<{ content: { text: string }[] }>('tools/call', {
        name: 'search',
        arguments: { query: '中文检索测试' },
      });
      const sData = JSON.parse(s.content[0].text) as { hits: { doc_id: string }[] };
      expect(sData.hits.map((h) => h.doc_id)).toContain(wData.doc_id);

      // read
      const r = await rpc.request<{ content: { text: string }[] }>('tools/call', {
        name: 'read',
        arguments: { doc_id: wData.doc_id },
      });
      const rData = JSON.parse(r.content[0].text) as { title: string; content: string };
      expect(rData.title).toBe('知识库冒烟测试');
      expect(rData.content).toContain('MCP 协议');

      // delete（软删除）
      const d = await rpc.request<{ content: { text: string }[]; isError?: boolean }>('tools/call', {
        name: 'delete',
        arguments: { doc_id: wData.doc_id, confirm: true },
      });
      expect(d.isError).toBeUndefined();
      const dData = JSON.parse(d.content[0].text) as { deleted: boolean };
      expect(dData.deleted).toBe(true);

      // 删除后 search 不再召回
      const s2 = await rpc.request<{ content: { text: string }[] }>('tools/call', {
        name: 'search',
        arguments: { query: '中文检索测试' },
      });
      const s2Data = JSON.parse(s2.content[0].text) as { hits: { doc_id: string }[] };
      expect(s2Data.hits.map((h) => h.doc_id)).not.toContain(wData.doc_id);
    });
  });

  describe('ALLOW_DELETE=true 但 ALLOW_WRITE 未开', () => {
    let rpc: RpcClient;
    beforeAll(async () => {
      rpc = await startServer({ LIBRARY_ALLOW_DELETE: 'true' });
      await init(rpc);
    });
    afterAll(() => rpc?.close());

    it('仍只有 3 个只读工具（delete 依赖 write）', async () => {
      const res = await rpc.request<{ tools: { name: string }[] }>('tools/list');
      expect(res.tools).toHaveLength(3);
      expect(res.tools.map((t) => t.name)).not.toContain('delete');
    });
  });

  describe('LIBRARY_ROOT 指向不可写位置', () => {
    it('进程退出码非 0（致命 init 错误）', async () => {
      // Windows 下指向一个已存在的文件路径（无法 mkdir）最可移植
      const notADir = join(tmpdir(), `library-mcp-notdir-${Date.now()}`);
      const { writeFileSync } = await import('node:fs');
      writeFileSync(notADir, 'x', 'utf8');
      const child = spawn(process.execPath, [distIndex], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LIBRARY_ROOT: notADir },
      });
      child.stderr!.on('data', () => {});
      const code = await new Promise<number | null>((res) => child.on('exit', (c) => res(c)));
      expect(code).not.toBe(0);
      rmSync(notADir, { force: true });
    });
  });
});
