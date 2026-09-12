// 入口：env 校验 → storage.init（启动期自动初始化，决策 #2）→ McpServer → 按开关注册工具 → stdio
// 日志一律走 console.error（stderr）——stdout 只给 JSON-RPC

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import pkg from '../package.json' with { type: 'json' };
import { loadConfig, log } from './config.js';
import { Storage } from './storage.js';
import type { ToolContext } from './context.js';
import { registerSearchTool } from './tools/search.js';
import { registerReadTool } from './tools/read.js';
import { registerListTool } from './tools/list.js';
import { registerWriteTool } from './tools/write.js';
import { registerDeleteTool } from './tools/delete.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // 启动期自动 init（决策 #2）：建目录 → 校验可写 → 打开/恢复 sqlite → 建表 → FTS rebuild
  // 致命错误（目录不可写 / sqlite 打不开且无法备份重建）抛出 → exit 1
  const storage = new Storage(config);
  storage.init();

  const server = new McpServer({
    name: 'library-mcp',
    version: pkg.version,
  });

  const ctx: ToolContext = { storage, config };
  registerSearchTool(server, ctx);
  registerReadTool(server, ctx);
  registerListTool(server, ctx);
  if (config.allowWrite) {
    registerWriteTool(server, ctx);
    if (config.allowDelete) {
      registerDeleteTool(server, ctx);
    }
  }

  await server.connect(new StdioServerTransport());

  // 状态打印（stderr）——配置问题第一时间可见
  log(config, 'info', `v${pkg.version} started`);
  log(config, 'info', `  root: ${config.root}`);
  log(
    config,
    'info',
    `  write: ${config.allowWrite ? 'ENABLED' : 'DISABLED（设 LIBRARY_ALLOW_WRITE=true 开启）'}`,
  );
  log(
    config,
    'info',
    `  delete: ${config.allowWrite && config.allowDelete ? 'ENABLED' : 'DISABLED（需 ALLOW_WRITE + ALLOW_DELETE 同时为 true）'}`,
  );
}

main().catch((e) => {
  console.error('[library-mcp] Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
