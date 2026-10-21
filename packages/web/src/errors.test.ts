import type { ErrorEvent } from '@sentry/browser';
import { describe, expect, it, vi } from 'vitest';
import { OUR_FILES, reportUnexpected, scrubEvent } from './errors.ts';

describe('scrubEvent', () => {
  it('drops breadcrumbs, extra data, the user, the referrer and the URL hash and query', () => {
    const event = scrubEvent({
      type: undefined,
      breadcrumbs: [{ message: 'ui.click: 第一章 雾中战士' }],
      extra: { title: 'Piranesi' },
      user: { ip_address: '1.2.3.4' },
      request: {
        url: 'https://example.pages.dev/?x=1#privacy',
        headers: { Referer: 'https://www.douban.com/', 'User-Agent': 'Mozilla/5.0 Safari' },
      },
    });
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({
      url: 'https://example.pages.dev/',
      headers: { 'User-Agent': 'Mozilla/5.0 Safari' },
    });
  });

  it('cuts long error messages', () => {
    const event = scrubEvent({
      type: undefined,
      exception: { values: [{ type: 'Error', value: 'x'.repeat(1000) }] },
    } as ErrorEvent);
    expect(event.exception?.values?.[0]?.value).toHaveLength(301);
  });
});

describe('OUR_FILES', () => {
  it('matches our own files on the live site and on preview deploys', () => {
    expect(OUR_FILES.test('https://epubmerger.pages.dev/assets/index-CTVuNv4i.js')).toBe(true);
    expect(OUR_FILES.test('https://a1b2c3d4.epubmerger.pages.dev/assets/worker-x.js')).toBe(true);
  });

  it('does not match browser extensions or look-alike hosts', () => {
    expect(OUR_FILES.test('chrome-extension://abcdef/content.js')).toBe(false);
    expect(OUR_FILES.test('https://epubmerger.pages.dev.evil.com/x.js')).toBe(false);
    expect(OUR_FILES.test('https://notepubmerger.pages.dev/x.js')).toBe(false);
  });
});

describe('reportUnexpected', () => {
  it('only logs to the console during development and tests', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    reportUnexpected(new Error('boom'), 'merge');
    expect(debug).toHaveBeenCalledWith('[errors]', 'merge', new Error('boom'));
    debug.mockRestore();
  });
});
