import { describe, expect, it } from 'vitest';
import { countTextChars } from './checks.ts';

describe('countTextChars', () => {
  it('counts visible characters only', () => {
    const xhtml = `<html><head><title>Ignored title</title><style>p { color: red }</style></head>
<body><!-- comment --><p>Hello, <b>world</b>!</p><p>中文&nbsp;字</p><script>var x = 1;</script></body></html>`;
    // "Hello,world!" = 12，"中文" + 实体 + "字" = 4
    expect(countTextChars(xhtml)).toBe(16);
  });
});
