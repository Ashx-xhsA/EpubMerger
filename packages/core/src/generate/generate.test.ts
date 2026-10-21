import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildEpub, CONTENT_OPF } from '../epub/test-helpers.ts';
import { parseEpub } from '../epub/parse.ts';
import type { Book } from '../epub/types.ts';
import { extractBlocks } from '../extract/extract.ts';
import type { BlockPair } from '../paragraphs/align-book.ts';
import { generateBilingual, type GenerateInput } from './generate.ts';

const EN = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title><link rel="stylesheet" href="../Styles/style.css"/></head>
<body>${body}</body>
</html>`;

const filler = '<p>The beauty of the House is immeasurable; its kindness infinite.</p>'.repeat(50);

function parse(bytes: Uint8Array): Book {
  const result = parseEpub(bytes);
  if (!result.ok) throw new Error(result.error.message);
  return result.book;
}

const enBook = parse(
  buildEpub({
    'OEBPS/Text/ch1.xhtml': EN(
      `<h1 id="c1">Chapter 1</h1><p class="a">One.</p><p>Two.</p>${filler}`,
    ),
  }),
);
const zhBook = parse(
  buildEpub({
    'OEBPS/Text/ch1.xhtml': EN(
      `<h1>第一章</h1><p class="zh" id="p1">一&nbsp;<i>一</i>。<sup><a href="#n1">1</a></sup></p><p>二。</p>${filler}`,
    ),
  }),
);
const enBlocks = extractBlocks(enBook).blocks;
const zhBlocks = extractBlocks(zhBook).blocks;

/** 前三块一对一，后面的填充段不配 */
const pairs: BlockPair[] = [0, 1, 2].map((i) => ({
  group: 0,
  skeleton: [enBlocks[i]!],
  other: [zhBlocks[i]!],
}));

function generate(changes: Partial<GenerateInput> = {}) {
  const result = generateBilingual({
    skeleton: enBook,
    skeletonLang: 'en',
    otherLang: 'zh-Hans',
    pairs,
    otherFirst: false,
    title: 'Test Book / 测试书',
    uuid: 'fixed',
    now: new Date('2026-10-18T00:00:00Z'),
    ...changes,
  });
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe('generateBilingual', () => {
  it('produces an ePub our own parser reads back, with both languages interleaved', () => {
    const { bytes, report } = generate();
    expect(report.inserted).toBe(3);
    expect(report.dropped).toEqual([]);
    expect(report.changedFiles.sort()).toEqual([
      'OEBPS/Text/ch1.xhtml',
      'OEBPS/bilingual.css',
      'OEBPS/content.opf',
      'OEBPS/toc.ncx',
    ]);

    const parsed = parseEpub(bytes);
    expect(parsed.ok && parsed.warnings).toEqual([]);
    const book = parse(bytes);
    expect(book.metadata.title).toBe('Test Book / 测试书');
    expect(book.metadata.identifier).toBe('urn:uuid:fixed');
    expect(book.metadata.languages).toEqual(['en', 'zh-Hans']);
    const texts = extractBlocks(book).blocks.map((b) => b.text);
    expect(texts.slice(0, 7)).toEqual([
      'Chapter 1',
      '第一章',
      'One.',
      '一 一。',
      'Two.',
      '二。',
      texts[6],
    ]);
    expect(texts).toHaveLength(enBlocks.length + 3);
  });

  it('writes the inserted elements, css link and stylesheet', () => {
    const { bytes } = generate();
    const files = unzipSync(bytes);
    const xhtml = new TextDecoder().decode(files['OEBPS/Text/ch1.xhtml']);
    expect(xhtml).toContain(
      '<h1 id="c1">Chapter 1</h1><h1 class="bi-insert" xml:lang="zh-Hans">第一章</h1>',
    );
    expect(xhtml).toContain('<p class="bi-insert" xml:lang="zh-Hans">一\u00a0<i>一</i>。</p>');
    expect(xhtml).toContain('href="../bilingual.css"/></head>');
    const css = new TextDecoder().decode(files['OEBPS/bilingual.css']);
    expect(css).toContain('.bi-insert');
    // 插入的中文段落缩进两个字，EPUB 2 只有 xml:lang 也要能匹配
    expect(css).toContain('p.bi-insert:lang(zh),\np.bi-insert[lang|="zh"] {\n  text-indent: 2em;');
    // 骨架书没改的部分原样保留
    expect(xhtml).toContain(filler);
  });

  it('puts mimetype first and uncompressed', () => {
    const { bytes } = generate();
    // zip 第一个文件的本地文件头：第 8–9 字节是压缩方式（0 = 不压缩），第 30 字节起是文件名
    expect(bytes[8]).toBe(0);
    expect(bytes[9]).toBe(0);
    expect(new TextDecoder().decode(bytes.slice(30, 38))).toBe('mimetype');
  });

  it('puts the other language first when asked', () => {
    const texts = extractBlocks(parse(generate({ otherFirst: true }).bytes)).blocks.map(
      (b) => b.text,
    );
    expect(texts.slice(0, 6)).toEqual(['第一章', 'Chapter 1', '一 一。', 'One.', '二。', 'Two.']);
  });

  it('writes lang as well in ePub 3 and updates dcterms:modified', () => {
    const epub3 = parse(
      buildEpub({
        'OEBPS/content.opf': CONTENT_OPF.replace('version="2.0"', 'version="3.0"'),
        'OEBPS/Text/ch1.xhtml': EN(`<p>One.</p>${filler}`),
      }),
    );
    const blocks = extractBlocks(epub3).blocks;
    const { bytes } = generate({
      skeleton: epub3,
      pairs: [{ group: 0, skeleton: [blocks[0]!], other: [zhBlocks[1]!] }],
    });
    const files = unzipSync(bytes);
    const decode = (p: string) => new TextDecoder().decode(files[p]);
    expect(decode('OEBPS/Text/ch1.xhtml')).toContain('xml:lang="zh-Hans" lang="zh-Hans"');
    expect(decode('OEBPS/content.opf')).toContain('2026-10-18T00:00:00Z');
  });

  it('reports blocks it could not place', () => {
    const { report } = generate({
      pairs: [...pairs, { group: 1, skeleton: [], other: [zhBlocks[3]!] }],
    });
    expect(report.dropped).toHaveLength(1);
    expect(report.dropped[0]?.reason).toBe('NO_SKELETON_IN_GROUP');
  });

  describe('columns', () => {
    it('wraps each pair in a two-cell table that our parser reads back', () => {
      const { bytes, report } = generate({ layout: 'columns' });
      expect(report.inserted).toBe(3);
      expect(report.rows).toBe(3);
      expect(report.columnFallbacks).toBe(0);
      const xhtml = new TextDecoder().decode(unzipSync(bytes)['OEBPS/Text/ch1.xhtml']);
      expect(xhtml).toContain(
        '<table class="bi-row"><tr><td class="bi-left"><h1 id="c1">Chapter 1</h1></td>' +
          '<td class="bi-right"><h1 class="bi-insert" xml:lang="zh-Hans">第一章</h1></td></tr></table>',
      );
      // 每个表格被抽成一个块（0.4 的规则：格子之间不加空格）
      const texts = extractBlocks(parse(bytes)).blocks.map((b) => b.text);
      expect(texts.slice(0, 3)).toEqual(['Chapter 1第一章', 'One.一 一。', 'Two.二。']);
      expect(texts).toHaveLength(enBlocks.length);
    });

    it('falls back to stacked for pairs it cannot wrap', () => {
      const listBook = parse(
        buildEpub({ 'OEBPS/Text/ch1.xhtml': EN(`<ul><li>Item.</li></ul>${filler}`) }),
      );
      const blocks = extractBlocks(listBook).blocks;
      const { bytes, report } = generate({
        skeleton: listBook,
        layout: 'columns',
        pairs: [{ group: 0, skeleton: [blocks[0]!], other: [zhBlocks[2]!] }],
      });
      expect(report.rows).toBe(0);
      expect(report.columnFallbacks).toBe(1);
      const xhtml = new TextDecoder().decode(unzipSync(bytes)['OEBPS/Text/ch1.xhtml']);
      expect(xhtml).toContain('<li>Item.</li><li class="bi-insert" xml:lang="zh-Hans">二。</li>');
    });
  });
});
