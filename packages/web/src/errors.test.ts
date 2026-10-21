import type { ErrorEvent } from '@sentry/browser';
import { describe, expect, it, vi } from 'vitest';
import { reportUnexpected, scrubEvent } from './errors.ts';

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

describe('reportUnexpected', () => {
  it('only logs to the console during development and tests', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    reportUnexpected(new Error('boom'), 'merge');
    expect(debug).toHaveBeenCalledWith('[errors]', 'merge', new Error('boom'));
    debug.mockRestore();
  });
});
