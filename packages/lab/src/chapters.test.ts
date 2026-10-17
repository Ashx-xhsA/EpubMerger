import type { Block } from '@epubmerger/core';
import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  inBookOrder,
  mapHtml,
  prefill,
  preview,
  validate,
  withTitles,
} from './chapters.ts';

function block(text: string, region: Block['region'] = 'body'): Block {
  return { kind: 'para', text, html: '', file: 'a.xhtml', ids: [], className: '', region };
}

describe('prefill', () => {
  it('pairs in order and leaves the extra sections unmerged', () => {
    expect(prefill(2, 3)).toEqual([
      { en: [0], zh: [0] },
      { en: [1], zh: [1] },
      { en: [], zh: [2] },
    ]);
  });

  it('puts empty sections in their own group', () => {
    const empty = (side: 'en' | 'zh', i: number) => side === 'zh' && i === 0;
    expect(prefill(2, 3, empty)).toEqual([
      { en: [], zh: [0] },
      { en: [0], zh: [1] },
      { en: [1], zh: [2] },
    ]);
  });
});

describe('validate', () => {
  it('accepts many-to-one and unmerged groups', () => {
    const groups = [
      { en: [], zh: [0] },
      { en: [0, 1, 2], zh: [1] },
      { en: [3], zh: [] },
    ];
    expect(validate(groups, 4, 2)).toEqual([]);
  });

  it('reports missing, duplicated, out-of-order and non-consecutive sections', () => {
    expect(validate([{ en: [0], zh: [0] }], 2, 1)).toEqual(['en: missing 1']);
    expect(
      validate(
        [
          { en: [0], zh: [0] },
          { en: [0], zh: [1] },
        ],
        1,
        2,
      ),
    ).toEqual(['en: duplicate or unknown 0']);
    expect(
      validate(
        [
          { en: [1], zh: [0] },
          { en: [0], zh: [1] },
        ],
        2,
        2,
      ),
    ).toEqual(['en: sections are out of order']);
    expect(
      validate(
        [
          { en: [0, 2], zh: [0] },
          { en: [1], zh: [] },
        ],
        3,
        1,
      ),
    ).toContain('group 0: en sections are not consecutive');
  });
});

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

describe('withTitles', () => {
  const sections = (...titles: string[]) =>
    titles.map((title) => ({ title, depth: 0, blocks: [block('text')] }));

  it('puts each side’s section titles on the group and keeps the section ids', () => {
    const groups = withTitles(
      [
        { en: [0, 1], zh: [0] },
        { en: [2], zh: [] },
      ],
      sections('Cover', 'One', 'Afterword'),
      sections('第一章'),
    );
    expect(groups).toEqual([
      { en: [0, 1], zh: [0], titles: { en: ['Cover', 'One'], zh: ['第一章'] } },
      { en: [2], zh: [], titles: { en: ['Afterword'], zh: [] } },
    ]);
  });

  it('replaces titles a group already had', () => {
    const [g] = withTitles(
      [{ en: [0], zh: [0], titles: { en: ['old'], zh: ['old'] } }],
      sections('New'),
      sections('新'),
    );
    expect(g?.titles).toEqual({ en: ['New'], zh: ['新'] });
  });
});

describe('inBookOrder', () => {
  it('puts lone sections that were appended at the end back where they belong', () => {
    const groups = [
      { en: [1], zh: [0] },
      { en: [3], zh: [2] },
      { en: [0], zh: [] },
      { en: [2], zh: [] },
      { en: [], zh: [1] },
      { en: [], zh: [3] },
    ];
    const ordered = inBookOrder(groups);
    expect(ordered).toEqual([
      { en: [0], zh: [] },
      { en: [1], zh: [0] },
      { en: [2], zh: [] },
      { en: [], zh: [1] },
      { en: [3], zh: [2] },
      { en: [], zh: [3] },
    ]);
    expect(validate(ordered, 4, 4)).toEqual([]);
  });
});
