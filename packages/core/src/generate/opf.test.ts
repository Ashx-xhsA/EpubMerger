import { describe, expect, it } from 'vitest';
import { CONTENT_OPF, TOC_NCX } from '../epub/test-helpers.ts';
import { modifiedTime, updateNcxUid, updateOpf, type OpfChanges } from './opf.ts';

const changes: OpfChanges = {
  title: 'Book / 书（双语）& more',
  identifier: 'urn:uuid:new',
  languages: ['en', 'zh-Hans'],
  css: { id: 'bilingual-css', href: 'bilingual.css' },
  modified: '2026-10-18T00:00:00Z',
};

describe('updateOpf', () => {
  it('replaces title, unique identifier and languages, and adds the css to the manifest', () => {
    const opf = updateOpf(CONTENT_OPF, false, changes)!;
    expect(opf).toContain('<dc:title>Book / 书（双语）&amp; more</dc:title>');
    expect(opf).toContain('<dc:identifier id="uid">urn:uuid:new</dc:identifier>');
    expect(opf).toContain('<dc:language>en</dc:language><dc:language>zh-Hans</dc:language>');
    expect(opf).toContain(
      '<item id="bilingual-css" href="bilingual.css" media-type="text/css"/></manifest>',
    );
    expect(opf).not.toContain('dcterms:modified');
    // 其他地方原样不动
    expect(opf).toContain('<dc:creator>Test Author</dc:creator>');
    expect(opf).toContain('<spine toc="ncx">');
  });

  it('keeps other identifiers, drops scheme attributes and removes extra languages', () => {
    const source = CONTENT_OPF.replace(
      '<dc:identifier id="uid">urn:uuid:12345</dc:identifier>',
      '<dc:identifier id="uid" opf:scheme="ISBN">9780000000000</dc:identifier>' +
        '<dc:identifier opf:scheme="ISBN">9781111111111</dc:identifier>',
    ).replace(
      '<dc:language>en</dc:language>',
      '<dc:language>en</dc:language><dc:language>fr</dc:language>',
    );
    const opf = updateOpf(source, false, changes)!;
    expect(opf).toContain('<dc:identifier id="uid">urn:uuid:new</dc:identifier>');
    expect(opf).toContain('9781111111111');
    expect(opf).not.toContain('<dc:language>fr</dc:language>');
  });

  it('sets dcterms:modified in ePub 3, adding it when missing', () => {
    const added = updateOpf(CONTENT_OPF, true, changes)!;
    expect(added).toContain(
      '<meta property="dcterms:modified">2026-10-18T00:00:00Z</meta></metadata>',
    );
    const existing = CONTENT_OPF.replace(
      '</metadata>',
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>',
    );
    const replaced = updateOpf(existing, true, changes)!;
    expect(replaced).toContain('<meta property="dcterms:modified">2026-10-18T00:00:00Z</meta>');
    expect(replaced).not.toContain('2020-01-01');
  });

  it('returns null without metadata or manifest', () => {
    expect(updateOpf('<package/>', false, changes)).toBeNull();
  });
});

describe('updateNcxUid', () => {
  it('replaces dtb:uid', () => {
    const ncx = TOC_NCX.replace(
      '<navMap>',
      '<head><meta name="dtb:uid" content="old"/><meta name="dtb:depth" content="1"/></head><navMap>',
    );
    const out = updateNcxUid(ncx, 'urn:uuid:new');
    expect(out).toContain('<meta name="dtb:uid" content="urn:uuid:new"/>');
    expect(out).toContain('<meta name="dtb:depth" content="1"/>');
  });
});

describe('modifiedTime', () => {
  it('drops milliseconds', () => {
    expect(modifiedTime(new Date('2026-10-18T01:02:03.456Z'))).toBe('2026-10-18T01:02:03Z');
  });
});
