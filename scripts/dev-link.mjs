#!/usr/bin/env node
// 联调开关：让插件消费本地 mcp-server 构建产物，而不是 npm 上的发布版
// 用法：node scripts/dev-link.mjs           # build + 切到本地 dist
//       node scripts/dev-link.mjs revert    # 切回 npx 发布版

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_JSON = resolve(ROOT, 'plugin', '.claude-plugin', 'plugin.json');

const NPM_MODE = {
  command: 'npx',
  args: ['-y', '@jesonliu/library-mcp'],
};
const LOCAL_MODE = {
  command: 'node',
  args: ['${CLAUDE_PLUGIN_ROOT}/../mcp-server/dist/index.js'],
};

if (process.argv[2] === 'revert') {
  patch(NPM_MODE);
  console.log('[dev-link] 已切回 npx 发布版（记得重启 Claude Code 会话）');
  process.exit(0);
}

console.log('[dev-link] 构建 mcp-server ...');
execSync('npm run build', { cwd: resolve(ROOT, 'mcp-server'), stdio: 'inherit' });
patch(LOCAL_MODE);
console.log('[dev-link] plugin.json 已指向本地 dist/index.js（重启 Claude Code 会话生效）');
console.log('[dev-link] 切回发布版：node scripts/dev-link.mjs revert');

// 直接改 JSON 对象（正则 replace 对 npx↔node 双向切换不可靠）
function patch(mode) {
  const json = JSON.parse(readFileSync(PLUGIN_JSON, 'utf8'));
  json.mcpServers['library-mcp'].command = mode.command;
  json.mcpServers['library-mcp'].args = mode.args;
  writeFileSync(PLUGIN_JSON, JSON.stringify(json, null, 2) + '\n', 'utf8');
}
