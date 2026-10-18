import { describe, expect, it } from 'vitest';
import { splitBlocks } from '../extract/blocks.ts';
import type { Block } from '../extract/types.ts';
import { applyEdits } from './edit.ts';
import { orphanRow, rowChecker, rowEdits } from './columns.ts';

const wrap = (body: string) =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body>${body}</body></html>`;

/** 文件文字和切出的块（splitBlocks 的块就带着 range） */
function blocksOf(body: string): { source: string; blocks: Block[] } {
  const source = wrap(body);
  const blocks = splitBlocks(source, 'a.xhtml').blocks.map((b) => ({
    ...b,
    region: 'body' as const,
  }));
  return { source, blocks };
}

describe('rowChecker', () => {
  it('accepts consecutive siblings, even with a page marker between them', () => {
    const { source, blocks } = blocksOf('<div><p>A</p><a id="p3"/><p>B</p></div><p>C</p>');
    const canWrap = rowChecker(source);
    expect(canWrap([blocks[0]!])).toBe(true);
    expect(canWrap([blocks[0]!, blocks[1]!])).toBe(true);
    expect(canWrap([blocks[2]!])).toBe(true);
  });

  it('rejects blocks under different parents, list items, and parents that cannot hold a table', () => {
    const { source, blocks } = blocksOf(
      '<div><p>A</p></div><div><p>B</p></div><ul><li>Item</li></ul><p>Loose<div>D</div></p>',
    );
    const canWrap = rowChecker(source);
    expect(canWrap([blocks[0]!, blocks[1]!])).toBe(false);
    expect(canWrap([blocks[2]!])).toBe(false); // <li>
    expect(blocks[3]?.text).toBe('Loose');
    expect(canWrap([blocks[3]!])).toBe(false); // 父元素是 <p>
  });

  it('rejects pairs spanning two files', () => {
    const { source, blocks } = blocksOf('<p>A</p><p>B</p>');
    expect(rowChecker(source)([blocks[0]!, { ...blocks[1]!, file: 'b.xhtml' }])).toBe(false);
  });
});

describe('rowEdits and orphanRow', () => {
  const { source, blocks } = blocksOf('<p>A</p><p>B</p>');
  const body = (text: string) => text.slice(text.indexOf('<body>') + 6, text.indexOf('</body>'));

  it('wraps the skeleton in the left cell and puts the other side on the right', () => {
    const out = applyEdits(source, rowEdits([blocks[0]!], ['<p>甲</p>'], false));
    expect(body(out)).toBe(
      '<table class="bi-row"><tr><td class="bi-left"><p>A</p></td><td class="bi-right"><p>甲</p></td></tr></table><p>B</p>',
    );
  });

  it('swaps sides when the other book goes first', () => {
    const out = applyEdits(source, rowEdits([blocks[0]!, blocks[1]!], ['<p>甲</p>'], true));
    expect(body(out)).toBe(
      '<table class="bi-row"><tr><td class="bi-left"><p>甲</p></td><td class="bi-right"><p>A</p><p>B</p></td></tr></table>',
    );
  });

  it('leaves the skeleton cell empty for unmatched blocks', () => {
    const at = blocks[0]!.range[1];
    expect(body(applyEdits(source, [orphanRow(at, ['<p>多</p>'], false)]))).toBe(
      '<p>A</p><table class="bi-row"><tr><td class="bi-left"></td><td class="bi-right"><p>多</p></td></tr></table><p>B</p>',
    );
  });
});
