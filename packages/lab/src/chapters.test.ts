import type { Block } from '@epubmerger/core';
import { describe, expect, it } from 'vitest';
import { escapeHtml, mapHtml, preview } from './chapters.ts';

function block(text: string, region: Block['region'] = 'body'): Block {
  return {
    kind: 'para',
    text,
    html: '',
    range: [0, 0],
    file: 'a.xhtml',
    ids: [],
    className: '',
    region,
  };
}

describe('preview', () => {
  it('keeps about 200 Chinese characters or 50 English words', () => {
    expect(preview([block('字'.repeat(300))], 'zh')).toBe('字'.repeat(200) + '…');
    const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
    expect(preview([block(words)], 'en').split(' ')).toHaveLength(51);
  });
});

describe('mapHtml', () => {
  const sections = (title: string) => [{ title, depth: 0, blocks: [block('text')] }];

  it('escapes book text', () => {
    expect(escapeHtml('a < b & "c"')).toBe('a &lt; b &amp; &quot;c&quot;');
    const html = mapHtml(
      't',
      { groups: [{ en: [0], zh: [0] }] },
      sections('<b>'),
      sections('x'),
      [],
    );
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('marks groups with an empty side as not merged', () => {
    const html = mapHtml(
      't',
      { groups: [{ en: [0], zh: [] }] },
      sections('Index'),
      sections('x'),
      [],
    );
    expect(html).toContain('class="group skipped"');
    expect(html).toContain('<div class="empty">不合并</div>');
  });
});
