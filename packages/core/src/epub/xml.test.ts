import { describe, expect, it } from 'vitest';
import { attr, childElements, findAll, findFirst, localName, parseXml, textOf } from './xml.ts';

describe('localName', () => {
  it('strips the prefix and lowercases', () => {
    expect(localName('dc:title')).toBe('title');
    expect(localName('navPoint')).toBe('navpoint');
  });
});

describe('findAll / findFirst', () => {
  it('matches with or without a namespace prefix', () => {
    const doc = parseXml(
      '<metadata><dc:title>A</dc:title><title xmlns="http://purl.org/dc/elements/1.1/">B</title></metadata>',
    );
    expect(findAll(doc, 'title').map(textOf)).toEqual(['A', 'B']);
    expect(findFirst(doc, 'title')?.name).toBe('dc:title');
    expect(findFirst(doc, 'creator')).toBeNull();
  });

  it('ignores tag name case', () => {
    const doc = parseXml('<navMap><navPoint/><NAVPOINT/></navMap>');
    expect(findAll(doc, 'navPoint')).toHaveLength(2);
  });
});

describe('childElements', () => {
  it('returns direct children only', () => {
    const doc = parseXml('<a><b id="1"><b id="2"/></b><c/><b id="3"/></a>');
    const a = findFirst(doc, 'a');
    if (a === null) throw new Error('no <a>');
    expect(childElements(a, 'b').map((el) => attr(el, 'id'))).toEqual(['1', '3']);
    expect(childElements(a)).toHaveLength(3);
  });
});

describe('attr', () => {
  it('matches exact names first, then by local name', () => {
    const doc = parseXml('<x opf:role="aut" epub:type="toc" id="a"/>');
    const x = findFirst(doc, 'x');
    if (x === null) throw new Error('no <x>');
    expect(attr(x, 'role')).toBe('aut');
    expect(attr(x, 'epub:type')).toBe('toc');
    expect(attr(x, 'type')).toBe('toc');
    expect(attr(x, 'missing')).toBeNull();
  });

  it('decodes entities', () => {
    const doc = parseXml('<a href="ch1.xhtml?x=1&amp;y=2"/>');
    const a = findFirst(doc, 'a');
    expect(a && attr(a, 'href')).toBe('ch1.xhtml?x=1&y=2');
  });
});

describe('textOf', () => {
  it('decodes HTML entities exactly once (nbsp becomes a plain space)', () => {
    const doc = parseXml('<t>A&nbsp;B&mdash;C &amp;nbsp; &#x4E2D;</t>');
    const t = findFirst(doc, 't');
    expect(t && textOf(t)).toBe('A B—C &nbsp; 中');
  });

  it('collapses whitespace and includes nested text', () => {
    const doc = parseXml('<t>\n  Chapter <b>One</b>\n  <!-- note -->\n</t>');
    const t = findFirst(doc, 't');
    expect(t && textOf(t)).toBe('Chapter One');
  });

  it('tolerates unclosed tags', () => {
    const doc = parseXml('<p>line one<br>line two</p>');
    const p = findFirst(doc, 'p');
    expect(p && textOf(p)).toBe('line oneline two');
  });
});
