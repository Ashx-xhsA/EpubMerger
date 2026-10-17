import { describe, expect, it } from 'vitest';
import { findFirst, parseXml } from '../epub/xml.ts';
import { elementText, isNoteRef, isPageMarker } from './text.ts';

function p(inner: string): string {
  const el = findFirst(parseXml(`<p>${inner}</p>`), 'p');
  if (el === null) throw new Error('no <p>');
  return elementText(el);
}

function first(xml: string, name: string) {
  const el = findFirst(parseXml(xml), name);
  if (el === null) throw new Error(`no <${name}>`);
  return el;
}

describe('elementText', () => {
  it('decodes entities and collapses whitespace including &nbsp;', () => {
    expect(p('  Tom &amp;&nbsp;&nbsp;Jerry\n   ran  ')).toBe('Tom & Jerry ran');
  });

  it('turns <br> into a newline and trims each line', () => {
    expect(p('Roses are red, <br/>  violets are blue<br/>')).toBe(
      'Roses are red,\nviolets are blue',
    );
  });

  it('removes soft hyphens, written as characters or entities', () => {
    expect(p('Fem\u00adin\u00adism and fem&shy;i&#173;nism')).toBe('Feminism and feminism');
  });

  it('keeps the text of inline elements', () => {
    expect(p('It was <i>the</i> <b>best</b> of times')).toBe('It was the best of times');
  });

  it('skips ruby annotations, scripts and styles', () => {
    expect(p('<ruby>漢<rt>kan</rt>字<rp>(</rp></ruby><script>x()</script><style>p{}</style>')).toBe(
      '漢字',
    );
  });

  it('drops footnote references but keeps ordinary links and superscripts', () => {
    expect(p('Fossils<a epub:type="noteref" href="#n1">1</a> are old.')).toBe('Fossils are old.');
    expect(p('化石<a type="noteref" href="part6.html#n1">[1]</a>很古老')).toBe('化石很古老');
    expect(p('Fossils<sup><a href="#n2">2</a></sup> are old.')).toBe('Fossils are old.');
    expect(p('Fossils<a href="#n3"><sup>3</sup></a> are old.')).toBe('Fossils are old.');
    expect(p('Fossils<a href="notes.html#n4">[4]</a> are old.')).toBe('Fossils are old.');
    expect(p('See <a href="#ch2">chapter 2</a>.')).toBe('See chapter 2.');
    expect(p('E = mc<sup>2</sup>')).toBe('E = mc2');
    expect(p('page <a href="#p12">12</a>')).toBe('page 12');
  });

  it('drops page markers that contain text', () => {
    expect(p('end of one<span epub:type="pagebreak" title="143">143</span> page')).toBe(
      'end of one page',
    );
    expect(p('word<span class="pagenum">[iv]</span> word')).toBe('word word');
    expect(p('<a epub:type="pagebreak" id="page3"/>When the Moon rose')).toBe('When the Moon rose');
  });
});

describe('isNoteRef', () => {
  it('does not treat a long superscript link as a note reference', () => {
    expect(isNoteRef(first('<sup><a href="#x">see note</a></sup>', 'sup'))).toBe(false);
  });
});

describe('isPageMarker', () => {
  it('needs a page-like class or id and a number', () => {
    expect(isPageMarker(first('<span class="pagenum">27</span>', 'span'))).toBe(true);
    expect(isPageMarker(first('<span class="pagenum">Chapter</span>', 'span'))).toBe(false);
    expect(isPageMarker(first('<span class="num">27</span>', 'span'))).toBe(false);
    expect(isPageMarker(first('<span role="doc-pagebreak" aria-label="5"/>', 'span'))).toBe(true);
  });
});
