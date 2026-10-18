// core 的测试在真实的 Chrome 里再跑一遍：pnpm test:browser。
// 用电脑上已装的 Chrome（channel: 'chrome'），不下载 Playwright 自带的浏览器。
// 测试跑在页面里，不是 Worker 里；Worker 没有的 DOMParser 这类东西由 core 的 tsconfig 在编译时挡住
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/core/src/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: 'chrome' } }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
