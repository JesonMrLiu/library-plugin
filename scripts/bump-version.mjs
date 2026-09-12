#!/usr/bin/env node
// 一键同步三处版本号：plugin/.claude-plugin/plugin.json、.claude-plugin/marketplace.json、根 package.json
// 用法：npm run bump -- 1.0.2

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 新增含版本号的文件时在此登记
const TARGETS = [
  'plugin/.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'package.json',
];

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
  console.error('用法: npm run bump -- <semver>（如 1.0.2）');
  process.exit(1);
}

for (const rel of TARGETS) {
  const file = resolve(ROOT, rel);
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    console.warn(`= ${rel}: 文件不存在，跳过`);
    continue;
  }
  const re = /("|')version\1\s*:\s*("|')([^"']+)\2/;
  if (!re.test(content)) {
    console.warn(`⚠ ${rel}: 未找到 version 字段，跳过`);
    continue;
  }
  const updated = content.replace(re, (_m, q1, q2, _old) => `${q1}version${q1}: ${q2}${version}${q2}`);
  writeFileSync(file, updated, 'utf8');
  console.log(`✓ ${rel}: ${content.match(re)?.[3]} → ${version}`);
}
