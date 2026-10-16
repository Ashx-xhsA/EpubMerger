import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { unzipEpub } from './zip.ts';

const SMALL = { maxFileBytes: 1000, maxUnzippedBytes: 5000 };

describe('unzipEpub', () => {
  it('unzips files and skips folders', () => {
    const zip = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'OEBPS/': {},
      'OEBPS/Text/ch01.xhtml': strToU8('<p>hi</p>'),
    });
    const result = unzipEpub(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.archive.paths.sort()).toEqual(['OEBPS/Text/ch01.xhtml', 'mimetype']);
    expect(result.archive.read('mimetype')).toEqual(strToU8('application/epub+zip'));
  });

  it('falls back to case-insensitive lookup', () => {
    const zip = zipSync({ 'OEBPS/text/ch01.xhtml': strToU8('<p>hi</p>') });
    const result = unzipEpub(zip);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.archive.read('OEBPS/Text/ch01.xhtml')).toEqual(strToU8('<p>hi</p>'));
    expect(result.archive.read('OEBPS/Text/missing.xhtml')).toBeNull();
  });

  it('accepts an empty zip (later checks report what is missing)', () => {
    const result = unzipEpub(zipSync({}));
    expect(result.ok).toBe(true);
  });

  it('rejects files that are not zip', () => {
    const result = unzipEpub(strToU8('this is not a zip file'));
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_EPUB' } });
  });

  it('rejects broken zip data', () => {
    const zip = zipSync({ 'a.txt': strToU8('hello') });
    const result = unzipEpub(zip.subarray(0, 20)); // 截断：开头还是 PK，但后面坏了
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_EPUB' } });
  });

  it('rejects files over the size limit', () => {
    const zip = zipSync({ 'a.bin': new Uint8Array(2000) }, { level: 0 }); // level 0：不压缩;
    const result = unzipEpub(zip, SMALL);
    expect(result).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } });
  });

  it('rejects zip bombs before unzipping', () => {
    // 1 万个 0 压缩后只有几十字节，没超过文件上限，但解压后超过上限
    const zip = zipSync({ 'bomb.txt': new Uint8Array(10_000) }, { level: 9 });
    expect(zip.length).toBeLessThan(SMALL.maxFileBytes);
    const result = unzipEpub(zip, SMALL);
    expect(result).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } });
  });
});
