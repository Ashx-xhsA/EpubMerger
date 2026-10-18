import { describe, expect, it } from 'vitest';
import { findCover } from './cover.ts';
import { parseEpub } from './parse.ts';
import { buildEpub } from './test-helpers.ts';

const IMAGE = new Uint8Array([0xff, 0xd8, 0xff]);

/** 造一本书：meta 放进 metadata，items 放进 manifest，files 是额外放进 zip 的文件 */
function bookWith(meta: string, items: string, files: Record<string, Uint8Array | string> = {}) {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="uid">urn:uuid:12345</dc:identifier>
    ${meta}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
    ${items}
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/></spine>
</package>`;
  const result = parseEpub(buildEpub({ 'OEBPS/content.opf': opf, ...files }));
  if (!result.ok) throw new Error(result.error.message);
  return result.book;
}

describe('findCover', () => {
  it('reads the ePub 3 cover-image property', () => {
    const book = bookWith(
      '',
      `<item id="a" href="images/a.jpg" media-type="image/jpeg"/>
       <item id="img" href="images/front.jpg" media-type="image/jpeg" properties="cover-image"/>`,
      { 'OEBPS/images/a.jpg': IMAGE, 'OEBPS/images/front.jpg': IMAGE },
    );
    expect(findCover(book)).toEqual({ path: 'OEBPS/images/front.jpg', mediaType: 'image/jpeg' });
  });

  it('reads the ePub 2 meta by manifest id', () => {
    const book = bookWith(
      '<meta name="cover" content="x_front"/>',
      '<item id="x_front" href="Images/front00250.jpeg" media-type="image/jpeg"/>',
      { 'OEBPS/Images/front00250.jpeg': IMAGE },
    );
    expect(book.metadata.coverId).toBe('x_front');
    expect(findCover(book)?.path).toBe('OEBPS/Images/front00250.jpeg');
  });

  it('falls back to the file name when the meta is not an id', () => {
    const book = bookWith(
      '<meta name="cover" content="front.png"/>',
      '<item id="img1" href="Images/front.png" media-type="image/png"/>',
      { 'OEBPS/Images/front.png': IMAGE },
    );
    expect(findCover(book)).toEqual({ path: 'OEBPS/Images/front.png', mediaType: 'image/png' });
  });

  it('ignores a meta that points to a page instead of an image', () => {
    const book = bookWith(
      '<meta name="cover" content="ch1"/>',
      '<item id="logo" href="images/pub.jpg" media-type="image/jpeg"/>',
      { 'OEBPS/images/pub.jpg': IMAGE },
    );
    expect(findCover(book)).toBeNull();
  });

  it('falls back to an image named cover', () => {
    const book = bookWith(
      '',
      `<item id="logo" href="images/pub.jpg" media-type="image/jpeg"/>
       <item id="img9" href="images/Cover.jpg" media-type="image/jpeg"/>`,
      { 'OEBPS/images/pub.jpg': IMAGE, 'OEBPS/images/Cover.jpg': IMAGE },
    );
    expect(findCover(book)?.path).toBe('OEBPS/images/Cover.jpg');
  });

  it('skips a declared cover whose file is missing', () => {
    const book = bookWith(
      '<meta name="cover" content="cover"/>',
      '<item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>',
    );
    expect(findCover(book)).toBeNull();
  });

  it('returns null when the book has no images', () => {
    expect(findCover(bookWith('', ''))).toBeNull();
  });
});
