import { describe, expect, it } from 'vitest';
import {
  dirname,
  relativePath,
  resolveHref,
  resolvePath,
  safeDecodeUri,
  splitFragment,
} from './path.ts';

describe('dirname', () => {
  it('returns the folder part', () => {
    expect(dirname('OEBPS/content.opf')).toBe('OEBPS');
    expect(dirname('OEBPS/Text/ch01.xhtml')).toBe('OEBPS/Text');
  });

  it('returns empty string for files at the zip root', () => {
    expect(dirname('content.opf')).toBe('');
  });
});

describe('splitFragment', () => {
  it('splits off the anchor', () => {
    expect(splitFragment('part0005.html#a1')).toEqual({ path: 'part0005.html', fragment: 'a1' });
  });

  it('returns null fragment when there is no anchor or it is empty', () => {
    expect(splitFragment('part0005.html')).toEqual({ path: 'part0005.html', fragment: null });
    expect(splitFragment('part0005.html#')).toEqual({ path: 'part0005.html', fragment: null });
  });
});

describe('safeDecodeUri', () => {
  it('decodes percent-encoding', () => {
    expect(safeDecodeUri('My%20Chapter.xhtml')).toBe('My Chapter.xhtml');
    expect(safeDecodeUri('%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml')).toBe('第一章.xhtml');
  });

  it('keeps malformed encoding as is', () => {
    expect(safeDecodeUri('100%.xhtml')).toBe('100%.xhtml');
  });
});

describe('relativePath', () => {
  it('goes up out of the source folder and down into the target', () => {
    expect(relativePath('OEBPS/Text', 'OEBPS/bilingual.css')).toBe('../bilingual.css');
    expect(relativePath('OEBPS', 'OEBPS/bilingual.css')).toBe('bilingual.css');
    expect(relativePath('', 'OEBPS/a b.css')).toBe('OEBPS/a%20b.css');
    expect(relativePath('A/B', 'C/x.css')).toBe('../../C/x.css');
  });
});

describe('resolvePath', () => {
  it('joins relative paths onto the base folder', () => {
    expect(resolvePath('OEBPS', 'Text/ch01.xhtml')).toBe('OEBPS/Text/ch01.xhtml');
    expect(resolvePath('', 'content.opf')).toBe('content.opf');
  });

  it('handles . and ..', () => {
    expect(resolvePath('OEBPS/Text', '../Images/a.jpg')).toBe('OEBPS/Images/a.jpg');
    expect(resolvePath('OEBPS', './Text/./ch01.xhtml')).toBe('OEBPS/Text/ch01.xhtml');
  });

  it('ignores .. beyond the zip root', () => {
    expect(resolvePath('OEBPS', '../../a.jpg')).toBe('a.jpg');
  });

  it('treats a leading slash as the zip root', () => {
    expect(resolvePath('OEBPS/Text', '/Images/a.jpg')).toBe('Images/a.jpg');
  });
});

describe('resolveHref', () => {
  it('splits, decodes and resolves', () => {
    expect(resolveHref('OEBPS', 'Text/My%20Chapter.xhtml#sec%202')).toEqual({
      path: 'OEBPS/Text/My Chapter.xhtml',
      fragment: 'sec 2',
    });
  });

  it('returns null for links outside the book', () => {
    expect(resolveHref('OEBPS', 'https://example.com/')).toBeNull();
    expect(resolveHref('OEBPS', 'mailto:a@b.c')).toBeNull();
  });
});
