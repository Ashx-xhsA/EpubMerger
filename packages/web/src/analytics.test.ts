import { describe, expect, it, vi } from 'vitest';
import {
  countDownload,
  initAnalytics,
  sizeBucket,
  toPayload,
  track,
  charsBucket,
} from './analytics.ts';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe('toPayload', () => {
  it('splits the event name from its fields', () => {
    expect(toPayload({ name: 'download', nth: '2-5' })).toEqual(['download', { nth: '2-5' }]);
  });

  it('keeps language codes and replaces anything else with und', () => {
    const event = (lang: string) =>
      toPayload({ name: 'book_loaded', result: 'ok', lang, size: '<5MB' })[1].lang;
    expect(event('en')).toBe('en');
    expect(event('zh-Hans')).toBe('zh-Hans');
    expect(event('Piranesi')).toBe('und');
    expect(event('皮拉内西')).toBe('und');
  });
});

describe('track', () => {
  it('only logs to the console during development and tests', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    track({ name: 'merge_cancelled', stage: 'paragraphs' });
    expect(debug).toHaveBeenCalledWith('[analytics]', 'merge_cancelled', { stage: 'paragraphs' });
    debug.mockRestore();
  });
});

describe('initAnalytics', () => {
  it('does nothing outside a production build', () => {
    // 测试环境没有 document，真去加脚本就会抛错
    expect(() => initAnalytics()).not.toThrow();
  });
});

describe('buckets', () => {
  it('sorts sizes and lengths into ranges', () => {
    expect(sizeBucket(1024)).toBe('<5MB');
    expect(sizeBucket(5 * 1024 * 1024)).toBe('5-20MB');
    expect(sizeBucket(99 * 1024 * 1024)).toBe('20-100MB');
    expect(sizeBucket(101 * 1024 * 1024)).toBe('>100MB');
    expect(charsBucket(299_999)).toBe('<300k');
    expect(charsBucket(700_000)).toBe('600k-1.2M');
    expect(charsBucket(2_000_000)).toBe('1.2M+');
  });

  it('counts downloads in this browser', () => {
    const storage = memoryStorage();
    const seen = Array.from({ length: 7 }, () => countDownload(() => storage));
    expect(seen).toEqual(['1', '2-5', '2-5', '2-5', '2-5', '6+', '6+']);
  });

  it('treats an unusable storage as the first download', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    expect(countDownload(blocked)).toBe('1');
  });
});

// 不运行，只给 TypeScript 检查：这些写法必须编译不通过
// 哪天类型被改松、这些变成合法的，pnpm typecheck 会报"没用到的 @ts-expect-error"
function _mustNotCompile(title: string) {
  // @ts-expect-error 事件里不能带书名
  track({ name: 'download', nth: '1', title });
  // @ts-expect-error 字段只能是固定的几个词
  track({ name: 'download', nth: title });
  // @ts-expect-error 没有这种事件
  track({ name: 'chapter_titles', titles: title });
}
void _mustNotCompile;
