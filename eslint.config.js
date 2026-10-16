import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/dist/', 'secret/', 'fixtures/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // 嵌进 review.html、在浏览器里运行的小脚本
    files: ['packages/lab/src/review-client.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
