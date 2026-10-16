import type { Block } from '@epubmerger/core';
import { describe, expect, it } from 'vitest';
import { escapeHtml, mapHtml, prefill, preview, splitSections, validate } from './chapters.ts';

function block(text: string, region: Block['region'] = 'body'): Block {
  return { kind: 'para', text, html: '', file: 'a.xhtml', ids: [], className: '', region };
}

const texts = (blocks: Block[]) => blocks.map((b) => b.text);

describe('splitSections', () => {
  const all = ['cover', 'a1', 'a2', 'b1', 'c1', 'c2'].map((t) => block(t));

  it('cuts at each start and puts what comes before the first entry in its own section', () => {
    const sections = splitSections(all, [
      { title: 'A', depth: 0, start: 1 },
      { title: 'B', depth: 0, start: 3 },
      { title: 'C', depth: 0, start: 4 },
    ]);
    expect(sections.map((s) => [s.title, texts(s.blocks)])).toEqual([
      ['（目录前）', ['cover']],
      ['A', ['a1', 'a2']],
      ['B', ['b1']],
      ['C', ['c1', 'c2']],
    ]);
  });

  it('gives a parent that starts where its first child starts an empty section', () => {
    const sections = splitSections(all, [
      { title: 'Part 1', depth: 0, start: 1 },
      { title: 'Ch 1', depth: 1, start: 1 },
      { title: 'Ch 2', depth: 1, start: 3 },
    ]);
    expect(sections.slice(1).map((s) => [s.title, texts(s.blocks)])).toEqual([
      ['Part 1', []],
      ['Ch 1', ['a1', 'a2']],
      ['Ch 2', ['b1', 'c1', 'c2']],
    ]);
  });

  it('never overlaps when an entry points backwards', () => {
    const sections = splitSections(all, [
      { title: 'A', depth: 0, start: 0 },
      { title: 'C', depth: 0, start: 4 },
      { title: 'B', depth: 0, start: 3 },
    ]);
    expect(sections.map((s) => [s.title, texts(s.blocks)])).toEqual([
      ['A', ['cover', 'a1', 'a2', 'b1']],
      ['C', []],
      ['B', ['c1', 'c2']],
    ]);
  });

  it('leaves out index and note blocks', () => {
    const sections = splitSections(
      [block('x'), block('note', 'notes'), block('idx', 'index')],
      [{ title: 'A', depth: 0, start: 0 }],
    );
    expect(texts(sections[0]!.blocks)).toEqual(['x']);
  });
});

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
