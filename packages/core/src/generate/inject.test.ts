import { describe, expect, it } from 'vitest';
import type { Block } from '../extract/types.ts';
import type { BlockPair } from '../paragraphs/align-book.ts';
import { applyEdits, insertAt } from './edit.ts';
import { insertedElement, placeBlocks, stylesheetEdit, utf8Declaration } from './inject.ts';

/** 骨架块：放在 a.xhtml 的 [start, start + 10) */
function skel(name: string, start: number): Block {
  return {
    kind: 'para',
    text: name,
    html: `<p>${name}</p>`,
    range: [start, start + 10],
    file: 'a.xhtml',
    ids: [],
    className: '',
    region: 'body',
  };
}

function other(text: string): Block {
  return { ...skel(text, 0), html: `<p class="x">${text}</p>`, file: 'b.xhtml' };
}

const pair = (group: number, s: Block[], o: Block[]): BlockPair => ({
  group,
  skeleton: s,
  other: o,
});

/** 每段放在哪里：[另一本的文字, 位置] */
const where = (pairs: BlockPair[], otherFirst: boolean) =>
  placeBlocks(pairs, otherFirst).placements.map((p) => [p.block.text, p.at]);

const A = skel('A', 0);
const B = skel('B', 20);
const C = skel('C', 40);

describe('placeBlocks', () => {
  it('puts the other side after the last skeleton block, or before the first', () => {
    const pairs = [pair(0, [A, B], [other('甲')]), pair(0, [C], [other('丙1'), other('丙2')])];
    expect(where(pairs, false)).toEqual([
      ['甲', 30],
      ['丙1', 50],
      ['丙2', 50],
    ]);
    expect(where(pairs, true)).toEqual([
      ['甲', 0],
      ['丙1', 40],
      ['丙2', 40],
    ]);
  });

  it('hangs unmatched blocks on the previous pair, or the next one at the start of a group', () => {
    const pairs = [
      pair(0, [], [other('头')]),
      pair(0, [A], [other('甲')]),
      pair(0, [], [other('多')]),
      pair(0, [B], []),
    ];
    expect(where(pairs, false)).toEqual([
      ['头', 0],
      ['甲', 10],
      ['多', 10],
    ]);
    // 另一本在前：挂到后一对的前面；组末没有后一对时挂到前一对的后面
    expect(where([...pairs, pair(0, [], [other('尾')])], true)).toEqual([
      ['头', 0],
      ['甲', 0],
      ['多', 20],
      ['尾', 30],
    ]);
  });

  it('does not cross group boundaries and drops groups without skeleton blocks', () => {
    const pairs = [pair(0, [A], []), pair(1, [], [other('孤')]), pair(2, [B], [other('乙')])];
    const result = placeBlocks(pairs, false);
    expect(result.placements.map((p) => p.block.text)).toEqual(['乙']);
    expect(result.dropped.map((d) => [d.reason, d.block.text])).toEqual([
      ['NO_SKELETON_IN_GROUP', '孤'],
    ]);
  });
});

describe('insertedElement', () => {
  const block = other('中文 <b>粗</b>');

  it('follows paragraph, heading and list tags, otherwise uses div', () => {
    expect(insertedElement('<p class="a">x</p>', block, 'zh-Hans', false)).toBe(
      '<p class="bi-insert" xml:lang="zh-Hans">中文 <b>粗</b></p>',
    );
    expect(insertedElement('<h2>T</h2>', block, 'zh-Hans', false)).toMatch(/^<h2 .*<\/h2>$/);
    expect(insertedElement('<li>x</li>', block, 'zh-Hans', false)).toMatch(/^<li /);
    expect(insertedElement('<td>x</td>', block, 'zh-Hans', false)).toMatch(/^<div /);
    expect(insertedElement('Loose text', block, 'zh-Hans', false)).toMatch(/^<div /);
    expect(insertedElement('<html:p>x</html:p>', block, 'zh-Hans', false)).toMatch(/^<html:p /);
  });

  it('writes lang only in ePub 3', () => {
    expect(insertedElement('<p>x</p>', block, 'en', true)).toBe(
      '<p class="bi-insert" xml:lang="en" lang="en">中文 <b>粗</b></p>',
    );
  });

  it('returns null when nothing is left after cleaning', () => {
    expect(
      insertedElement('<p>x</p>', { ...block, html: '<p><img src="a.jpg"/></p>' }, 'en', true),
    ).toBeNull();
  });
});

describe('stylesheetEdit', () => {
  it('adds the link right before </head>', () => {
    const xhtml = '<html><head><title>T</title></head><body/></html>';
    const edit = stylesheetEdit(xhtml, '../bilingual.css');
    expect(applyEdits(xhtml, [edit!])).toBe(
      '<html><head><title>T</title><link rel="stylesheet" type="text/css" href="../bilingual.css"/></head><body/></html>',
    );
    expect(stylesheetEdit('<html><body/></html>', 'x.css')).toBeNull();
  });
});

describe('utf8Declaration', () => {
  it('rewrites a non-UTF-8 encoding and leaves UTF-8 alone', () => {
    expect(utf8Declaration('<?xml version="1.0" encoding="GBK"?><html/>')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><html/>',
    );
    expect(utf8Declaration("<?xml version='1.0' encoding='utf-8'?>")).toBe(
      "<?xml version='1.0' encoding='utf-8'?>",
    );
    expect(utf8Declaration('<html/>')).toBe('<html/>');
  });
});

describe('applyEdits', () => {
  it('keeps the order of insertions at the same place and rejects overlaps', () => {
    expect(applyEdits('abc', [insertAt(1, 'X'), insertAt(1, 'Y'), insertAt(3, 'Z')])).toBe(
      'aXYbcZ',
    );
    expect(applyEdits('abcdef', [{ start: 1, end: 3, text: '-' }])).toBe('a-def');
    expect(() =>
      applyEdits('abcdef', [
        { start: 1, end: 3, text: '' },
        { start: 2, end: 4, text: '' },
      ]),
    ).toThrow();
  });
});
