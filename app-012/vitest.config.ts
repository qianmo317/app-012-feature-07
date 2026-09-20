import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // 测试均为纯逻辑（判定/计分/药柜整理），不依赖 DOM；
    // jsdom 30 依赖的 undici 需要 Node 22+，在 node:20 环境下加载即崩溃
    environment: 'node',
  },
});
