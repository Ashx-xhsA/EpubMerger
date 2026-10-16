import { describe, expect, it } from 'vitest';
import { parseEpub } from '../epub/parse.ts';
import { buildEpub, CHAPTER_XHTML, CONTENT_OPF, TOC_NCX } from '../epub/test-helpers.ts';
import { extractBlocks } from './extract.ts';

function xhtml(body: string): string {
  return `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title></head><body>${body}</body></html>`;
}

/** 测试书：版权页（linear=no 的封面另算）、两章正文、一个尾注文件 */
const OPF = CONTENT_OPF.replace(
  '<item id="ch1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>',
  `<item id="cover" href="Text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="copy" href="Text/copy.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="Text/notes.xhtml" media-type="application/xhtml+xml"/>`,
).replace(
  '<itemref idref="ch1"/>',
  `<itemref idref="cover" linear="no"/>
    <itemref idref="copy"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="notes"/>`,
);

const NCX = TOC_NCX.replace(
  '</navMap>',
  `<navPoint id="np2"><navLabel><text>Endnotes</text></navLabel><content src="Text/notes.xhtml"/></navPoint>
  </navMap>`,
);

const result = parseEpub(
  buildEpub({
    'OEBPS/content.opf': OPF,
    'OEBPS/toc.ncx': NCX,
    'OEBPS/Text/cover.xhtml': xhtml('<div><img src="../Images/cover.jpg"/></div>'),
    'OEBPS/Text/copy.xhtml': xhtml('<p>Copyright © 2020</p><p>ISBN 978-1</p>'),
    'OEBPS/Text/ch1.xhtml': CHAPTER_XHTML,
    'OEBPS/Text/ch2.xhtml': xhtml(
      '<h1 id="c2">Chapter 2</h1><p id="r1">Fossils<sup><a href="notes.xhtml#n1">1</a></sup> are old.</p>' +
        '<p>Inline note<a epub:type="noteref" href="#fn2">2</a>.</p>' +
        '<aside epub:type="footnote" id="fn2"><p>2 A footnote.</p></aside>',
    ),
    'OEBPS/Text/notes.xhtml': xhtml(
      '<h1>Endnotes</h1><p id="n1"><a href="ch2.xhtml#r1">1</a> Darwin, Origin.</p>',
    ),
  }),
);
if (!result.ok) throw new Error(result.error.message);
const { blocks, files } = extractBlocks(result.book);

describe('extractBlocks', () => {
  it('classifies every spine file in order and says why', () => {
    expect(files.map((f) => [f.href, f.region, f.reason, f.blockCount])).toEqual([
      ['OEBPS/Text/cover.xhtml', 'auxiliary', 'linear=no', 1],
      ['OEBPS/Text/copy.xhtml', 'copyright', 'content: ISBN, ©', 2],
      ['OEBPS/Text/ch1.xhtml', 'body', '', 51],
      ['OEBPS/Text/ch2.xhtml', 'body', '', 4],
      ['OEBPS/Text/notes.xhtml', 'notes', 'toc title: Endnotes', 2],
    ]);
  });

  it('returns all blocks in spine order with their region', () => {
    expect(blocks).toHaveLength(60);
    expect(blocks[0]).toMatchObject({ kind: 'image', region: 'auxiliary' });
    expect(blocks[3]).toMatchObject({ kind: 'heading', headingLevel: 1, text: 'Chapter 1' });
    expect(blocks.filter((b) => b.region === 'body')).toHaveLength(54);
  });

  it('marks footnotes inside body files as notes, and leaves the referring paragraph as body', () => {
    const ch2 = blocks.filter((b) => b.file === 'OEBPS/Text/ch2.xhtml');
    expect(ch2.map((b) => [b.text, b.region])).toEqual([
      ['Chapter 2', 'body'],
      ['Fossils are old.', 'body'],
      ['Inline note.', 'body'],
      ['2 A footnote.', 'notes'],
    ]);
  });

  it('marks a block pointed to by a note reference and starting with a link as a note', () => {
    // 这里整个文件已经是 notes；单独再造一个正文文件里的情况
    const book = parseEpub(
      buildEpub({
        'OEBPS/Text/ch1.xhtml': xhtml(
          '<p>Text<a href="#n9">[9]</a> here.</p><p id="n9"><a href="#back">[9]</a> The note.</p>',
        ),
      }),
    );
    if (!book.ok) throw new Error(book.error.message);
    expect(extractBlocks(book.book).blocks.map((b) => b.region)).toEqual(['body', 'notes']);
  });
});
