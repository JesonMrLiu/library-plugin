// 工具共享上下文：storage 单例 + config

import type { Config } from './config.js';
import type { Storage } from './storage.js';

export interface ToolContext {
  storage: Storage;
  config: Config;
}
