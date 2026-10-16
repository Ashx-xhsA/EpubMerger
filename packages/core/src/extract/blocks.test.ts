import { describe, expect, it } from 'vitest';
import { splitBlocks } from './blocks.ts';

function split(body: string) {
  return splitBlocks(
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body>${body}</body></html>`,
    'OEBPS/ch1.xhtml',
  );
}

function texts(body: string): string[] {
  return split(body).blocks.map((b) => b.text);
}

describe('splitBlocks', () => {
  it('takes one block per paragraph and records file and class', () => {
    const { blocks } = split('<p class="indent">One.</p><p>Two.</p>');
    expect(blocks.map((b) => [b.kind, b.text, b.className, b.file])).toEqual([
      ['para', 'One.', 'indent', 'OEBPS/ch1.xhtml'],
      ['para', 'Two.', '', 'OEBPS/ch1.xhtml'],
    ]);
    expect(blocks[0]?.html).toBe('<p class="indent">One.</p>');
  });

  it('ignores <head>', () => {
    expect(texts('<p>Body</p>')).toEqual(['Body']);
  });

  it('descends into nested divs down to the innermost blocks', () => {
    expect(texts('<div><div><div><p>A</p></div><p>B</p></div></div>')).toEqual(['A', 'B']);
  });

  it('treats a div without block children as a paragraph', () => {
    const { blocks } = split('<div class="txt">Just text in a div.</div>');
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([['para', 'Just text in a div.']]);
  });

  it('turns loose text in a container into its own block', () => {
    expect(texts('<div>Loose <i>text</i><p>Para</p>tail</div>')).toEqual([
      'Loose text',
      'Para',
      'tail',
    ]);
  });

  it('recognises headings, list items, quotes and separators', () => {
    const { blocks } = split(
      '<h2>Chapter</h2><ul><li>Item</li></ul><blockquote>Dear sir,</blockquote>' +
        '<blockquote><p>Quoted para</p></blockquote><p class="center">* * *</p>',
    );
    expect(blocks.map((b) => [b.kind, b.text, b.headingLevel])).toEqual([
      ['heading', 'Chapter', 2],
      ['list', 'Item', undefined],
      ['quote', 'Dear sir,', undefined],
      ['para', 'Quoted para', undefined],
      ['other', '* * *', undefined],
    ]);
  });

  it('drops empty paragraphs, including ones with only &nbsp;', () => {
    expect(texts('<p>A</p><p></p><p>&nbsp;&nbsp;</p><p> <br/> </p><p>B</p>')).toEqual(['A', 'B']);
  });

  it('keeps chapter numbers that are only digits', () => {
    expect(texts('<h2>1</h2><p class="chapnum">II</p>')).toEqual(['1', 'II']);
  });

  it('drops page-number blocks', () => {
    expect(
      texts('<p>A</p><p class="pagenum">143</p><div epub:type="pagebreak">144</div><p>B</p>'),
    ).toEqual(['A', 'B']);
  });

  it('does not let a self-closing anchor swallow the rest of the paragraph', () => {
    const { blocks } = split(
      '<p class="h1"><a epub:type="pagebreak" id="page3"/>When the Moon rose</p><p>Next</p>',
    );
    expect(blocks.map((b) => [b.text, b.ids])).toEqual([
      ['When the Moon rose', ['page3']],
      ['Next', []],
    ]);
  });

  it('makes image blocks for images and image-only paragraphs', () => {
    const { blocks } = split(
      '<p><img src="a.jpg"/></p><img src="b.jpg"/><p>Text <img src="c.jpg"/></p>',
    );
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ['image', ''],
      ['image', ''],
      ['para', 'Text'],
    ]);
  });

  it('splits a figure into an image and its caption', () => {
    const { blocks } = split(
      '<figure id="f1"><img src="a.jpg"/><figcaption>Fig. 1</figcaption></figure>',
    );
    expect(blocks.map((b) => [b.kind, b.text, b.ids])).toEqual([
      ['image', '', ['f1']],
      ['para', 'Fig. 1', []],
    ]);
  });

  it('keeps a table as one block', () => {
    const { blocks } = split('<table><tr><td><p>a</p></td><td>b</td></tr></table>');
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([['table', 'ab']]);
  });

  it('hands container ids and ids of dropped blocks to the next block', () => {
    const { blocks } = split(
      '<section id="c2"><p id="x"></p><a id="anchor"/><h2 id="h">Two</h2><p>Body <span id="s">x</span></p></section><p id="end"></p>',
    );
    expect(blocks.map((b) => b.ids)).toEqual([
      ['c2', 'x', 'anchor', 'h'],
      ['s', 'end'],
    ]);
  });

  it('marks blocks inside footnote containers', () => {
    const { blocks } = split(
      '<p>Body<a epub:type="noteref" href="#fn1">1</a></p>' +
        '<aside epub:type="footnote" id="fn1"><p><a href="#r1">1</a> A note.</p></aside>' +
        '<div class="fnote"><p>Note two</p></div><p>After</p>',
    );
    expect(blocks.map((b) => [b.text, b.inNote])).toEqual([
      ['Body', false],
      ['1 A note.', true],
      ['Note two', true],
      ['After', false],
    ]);
  });

  it('collects where note references point', () => {
    const { noteRefTargets, blocks } = split(
      '<p>a<sup><a href="notes.html#n1">1</a></sup> b<a href="#n2">[2]</a> <a href="#ch3">chapter 3</a></p>',
    );
    expect(noteRefTargets).toEqual(['notes.html#n1', '#n2']);
    expect(blocks[0]?.hasLink).toBe(true);
    expect(blocks[0]?.startsWithLink).toBe(false);
  });

  it('knows whether a block starts with a link', () => {
    const { blocks } = split(
      '<p>&nbsp;<span><a href="ch1.html#r1">[1]</a></span> A note.</p><p>Text <a href="#x">link</a></p><div><a href="#y">Loose</a> run<p>P</p></div>',
    );
    expect(blocks.map((b) => b.startsWithLink)).toEqual([true, false, true, false]);
  });

  it('reads epub:type from body and the single wrapper inside it', () => {
    expect(split('<section epub:type="copyright-page"><p>©</p></section>').rootTypes).toEqual([
      'copyright-page',
    ]);
    expect(split('<section epub:type="chapter"><p>A</p></section><p>B</p>').rootTypes).toEqual([]);
  });
});
