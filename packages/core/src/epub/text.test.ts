import { describe, expect, it } from 'vitest';
import { decodeText, detectEncoding } from './text.ts';

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));

// "中文" 的 GBK 编码
const ZHONGWEN_GBK = Uint8Array.of(0xd6, 0xd0, 0xce, 0xc4);

describe('detectEncoding', () => {
  it('defaults to utf-8', () => {
    expect(detectEncoding(ascii('<html><p>hi</p></html>'))).toBe('utf-8');
  });

  it('reads the BOM', () => {
    expect(detectEncoding(Uint8Array.of(0xef, 0xbb, 0xbf, 0x3c))).toBe('utf-8');
    expect(detectEncoding(Uint8Array.of(0xff, 0xfe, 0x3c, 0x00))).toBe('utf-16le');
    expect(detectEncoding(Uint8Array.of(0xfe, 0xff, 0x00, 0x3c))).toBe('utf-16be');
  });

  it('reads the XML declaration', () => {
    expect(detectEncoding(ascii('<?xml version="1.0" encoding="GBK"?><html/>'))).toBe('gbk');
  });

  it('reads <meta charset>', () => {
    expect(detectEncoding(ascii('<html><head><meta charset="gb2312"/></head></html>'))).toBe('gbk');
  });

  it('falls back to utf-8 for unknown encoding names', () => {
    expect(detectEncoding(ascii('<?xml version="1.0" encoding="no-such-thing"?>'))).toBe('utf-8');
  });
});

describe('decodeText', () => {
  it('decodes utf-8 and strips the BOM', () => {
    const bytes = concat(Uint8Array.of(0xef, 0xbb, 0xbf), new TextEncoder().encode('<p>中文</p>'));
    expect(decodeText(bytes)).toBe('<p>中文</p>');
  });

  it('decodes GBK when declared', () => {
    const bytes = concat(
      ascii('<?xml version="1.0" encoding="GBK"?><p>'),
      ZHONGWEN_GBK,
      ascii('</p>'),
    );
    expect(decodeText(bytes)).toBe('<?xml version="1.0" encoding="GBK"?><p>中文</p>');
  });
});
