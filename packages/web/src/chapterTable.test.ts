// 章节对照表的连线 ↔ 组转换和操作。
// 9 张确认过的章节表在 fixtures/ 里（不进 git），没有时那一组测试自动跳过

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateChapterMap, type ChapterGroup } from '@epubmerger/core';
import { describe, expect, it } from 'vitest';
import {
  changedSections,
  componentProblems,
  components,
  groupsFromLinks,
  linksFromGroups,
  linkPair,
  unpairGroup,
  type Empties,
  type Link,
} from './chapterTable.ts';

const FIXTURES = fileURLToPath(new URL('../../../fixtures', import.meta.url));

const maps = ['pairs', 'holdout'].flatMap((set) => {
  const dir = join(FIXTURES, set);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => join(dir, name, 'chapters.json'))
    .filter((path) => existsSync(path));
});

const paired = (groups: ChapterGroup[]) =>
  groups.filter((g) => g.en.length > 0 && g.zh.length > 0).map((g) => ({ en: g.en, zh: g.zh }));

const noEmpties = (first: number, second: number): Empties => ({
  first: Array<boolean>(first).fill(false),
  second: Array<boolean>(second).fill(false),
});

const l = (first: number, second: number): Link => ({ first, second });

describe.skipIf(maps.length === 0)('confirmed chapter maps survive groups → links → groups', () => {
  it.each(maps)('%s', (path) => {
    const { groups } = JSON.parse(readFileSync(path, 'utf8')) as { groups: ChapterGroup[] };
    const counts = {
      first: groups.flatMap((g) => g.en).length,
      second: groups.flatMap((g) => g.zh).length,
    };
    const empties = noEmpties(counts.first, counts.second);
    const links = linksFromGroups(groups);
    expect(componentProblems(components(links, empties))).toEqual([]);
    const back = groupsFromLinks(links, empties, counts);
    // 不合并的组可能被拆成一节一组，不影响段落配对，所以只比配对的组
    expect(paired(back)).toEqual(paired(groups));
    expect(validateChapterMap(back, counts.first, counts.second)).toEqual([]);
  });
});

describe('components / groupsFromLinks', () => {
  // 第一本：封面、三章；第二本：前言、第一章、第二章上、第二章下
  const groups: ChapterGroup[] = [
    { en: [0], zh: [] },
    { en: [], zh: [0] },
    { en: [1], zh: [1] },
    { en: [2, 3], zh: [2, 3] },
  ];

  it('links every pair inside a group', () => {
    expect(linksFromGroups(groups)).toEqual([l(1, 1), l(2, 2), l(2, 3), l(3, 2), l(3, 3)]);
  });

  it('joins sections linked through each other into one group', () => {
    // 2–2、3–2、3–3：第一本 2、3 和第二本 2、3 连在一起
    expect(components([l(3, 3), l(1, 1), l(2, 2), l(3, 2)], noEmpties(4, 4))).toEqual([
      { first: [1], second: [1] },
      { first: [2, 3], second: [2, 3] },
    ]);
  });

  it('turns links back into groups, with unlinked sections unmerged in book order', () => {
    expect(
      groupsFromLinks([l(1, 1), l(2, 2), l(3, 3), l(3, 2)], noEmpties(4, 4), {
        first: 4,
        second: 4,
      }),
    ).toEqual(groups);
  });

  it('pulls an empty section in between into the group', () => {
    const empties = { first: [false, true, false], second: [false] };
    expect(components([l(0, 0), l(2, 0)], empties)).toEqual([{ first: [0, 1, 2], second: [0] }]);
  });
});

describe('componentProblems', () => {
  it('accepts groups in order with gaps between them', () => {
    expect(
      componentProblems(components([l(1, 0), l(3, 2), l(4, 3), l(4, 4)], noEmpties(5, 5))),
    ).toEqual([]);
  });

  it('flags crossing groups', () => {
    expect(componentProblems(components([l(0, 0), l(1, 3), l(2, 2)], noEmpties(3, 4)))).toEqual([
      1, 2,
    ]);
  });

  it('flags a group with a gap on either side', () => {
    expect(componentProblems(components([l(0, 0), l(0, 2)], noEmpties(1, 3)))).toEqual([0]);
    expect(componentProblems(components([l(0, 0), l(2, 0)], noEmpties(3, 1)))).toEqual([0]);
  });
});

describe('linkPair', () => {
  const none = noEmpties(5, 5);

  it('adds a pair that conflicts with nothing', () => {
    expect(linkPair([l(0, 0)], 2, 2, none)).toEqual({ links: [l(0, 0), l(2, 2)], dropped: 0 });
  });

  it('replaces the old partners of both sections', () => {
    // 夜色温柔的情况：BOOK III 原来连着第二部，第三部原来连着后面两节；点 BOOK III ↔ 第三部 → 一对一
    const links = [l(0, 0), l(1, 1), l(2, 1), l(3, 2), l(4, 2)];
    expect(linkPair(links, 2, 2, none)).toEqual({
      links: [l(0, 0), l(1, 1), l(2, 2)],
      dropped: 0,
    });
  });

  it('drops crossing links and reports them', () => {
    expect(linkPair([l(0, 0), l(2, 0)], 1, 1, none)).toEqual({
      links: [l(0, 0), l(1, 1)],
      dropped: 1,
    });
  });

  it('lets an unpaired section next to a group join it (many to one)', () => {
    expect(linkPair([l(1, 1)], 2, 1, none)).toEqual({ links: [l(1, 1), l(2, 1)], dropped: 0 });
    expect(linkPair([l(1, 1)], 1, 2, none)).toEqual({ links: [l(1, 1), l(1, 2)], dropped: 0 });
  });

  it('replaces instead of joining when the unpaired section is not next to the group', () => {
    expect(linkPair([l(1, 1)], 3, 1, none)).toEqual({ links: [l(3, 1)], dropped: 0 });
  });

  it('counts empty sections in between as next to the group', () => {
    const empties = { first: [false, false, true, false], second: [false, false] };
    expect(linkPair([l(1, 1)], 3, 1, empties).links).toEqual([l(1, 1), l(3, 1)]);
  });

  it('always leaves a valid map', () => {
    let links = linksFromGroups([
      { en: [0], zh: [0] },
      { en: [1, 2], zh: [1] },
      { en: [3], zh: [2, 3] },
    ]);
    for (const [i, j] of [
      [4, 0],
      [0, 4],
      [2, 2],
      [3, 1],
      [1, 3],
      [4, 4],
      [3, 4],
    ] as const) {
      links = linkPair(links, i, j, none).links;
      expect(componentProblems(components(links, none))).toEqual([]);
    }
  });
});

describe('unpairGroup', () => {
  it('removes every link of the group', () => {
    const links = [l(0, 0), l(1, 1), l(2, 1), l(3, 2)];
    const comp = components(links, noEmpties(4, 3))[1]!;
    expect(unpairGroup(links, comp)).toEqual([l(0, 0), l(3, 2)]);
  });
});

describe('changedSections', () => {
  const l = (first: number, second: number): Link => ({ first, second });

  it('is zero when the table was not touched, in any order', () => {
    expect(changedSections([l(0, 0), l(1, 1)], [l(1, 1), l(0, 0)])).toBe(0);
  });

  it('counts sections on both sides whose partners changed', () => {
    // 第一本第 1 节从配第二本第 1 节改成第 2 节：第一本 1 节，第二本 1、2 两节都变了
    expect(changedSections([l(0, 0), l(1, 1)], [l(0, 0), l(1, 2)])).toBe(3);
    // 拆开一对：两边各一节变成没有搭档
    expect(changedSections([l(0, 0)], [])).toBe(2);
  });
});
