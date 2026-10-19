// 章节对照表的数据和操作。不依赖 React，组件只负责显示和调用这里的函数。
// 用户在两列卡片之间点选连线（trade-off 032）：一条连线是"第一本第 i 节 ↔ 第二本第 j 节"，
// 连在一起的节是一组。core 用"组"表示章节表（ChapterGroup：en 一侧是第一本，zh 一侧是第二本），
// 这里负责两种形状互相转换

import { inBookOrder, type ChapterGroup } from '@epubmerger/core';

export interface Link {
  first: number;
  second: number;
}

/** 连在一起的一组节，两边都按节号排好 */
export interface Component {
  first: number[];
  second: number[];
}

/** 两本书各自哪几节没有正文：这些节不能点，但可以被夹在一组中间 */
export interface Empties {
  first: boolean[];
  second: boolean[];
}

const range = (count: number) => [...Array(count).keys()];

/** core 的组 → 连线：两边都有的组，两边每一节两两相连 */
export function linksFromGroups(groups: ChapterGroup[]): Link[] {
  return groups.flatMap((g) => g.en.flatMap((first) => g.zh.map((second) => ({ first, second }))));
}

/** 补上夹在中间的空节：预填时没有正文的节不参与配对，一组里可能隔着一个（例如 [3, 5]） */
function fillEmpty(ids: number[], empty: boolean[]): number[] {
  const out = [...ids];
  for (let k = ids[0]! + 1; k < ids.at(-1)!; k++) {
    if (!ids.includes(k) && empty[k] === true) out.push(k);
  }
  return out.sort((a, b) => a - b);
}

/** 把连线分成组（连在一起的算一组），按第一本的节号排 */
export function components(links: Link[], empties: Empties): Component[] {
  // 并查集：第一本的节记成 i，第二本的节记成 -(j + 1)，放在同一张表里
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const { first, second } of links) parent.set(find(first), find(-(second + 1)));
  const byRoot = new Map<number, Component>();
  for (const { first, second } of links) {
    const root = find(first);
    const c = byRoot.get(root) ?? { first: [], second: [] };
    if (!c.first.includes(first)) c.first.push(first);
    if (!c.second.includes(second)) c.second.push(second);
    byRoot.set(root, c);
  }
  return [...byRoot.values()]
    .map((c) => ({
      first: fillEmpty(
        c.first.sort((a, b) => a - b),
        empties.first,
      ),
      second: fillEmpty(
        c.second.sort((a, b) => a - b),
        empties.second,
      ),
    }))
    .sort((a, b) => a.first[0]! - b.first[0]!);
}

const consecutive = (ids: number[]) => ids.every((id, k) => k === 0 || id === ids[k - 1]! + 1);

/**
 * 有问题的组（components 里的序号）：组里有一边不连续（中间隔着别的有正文的节），
 * 或者和前一组交叉（第二本的节号没有往后走）
 */
export function componentProblems(comps: Component[]): number[] {
  const bad = new Set<number>();
  comps.forEach((c, k) => {
    if (!consecutive(c.first) || !consecutive(c.second)) bad.add(k);
    const prev = comps[k - 1];
    if (prev !== undefined && prev.second.at(-1)! >= c.second[0]!) {
      bad.add(k - 1);
      bad.add(k);
    }
  });
  return [...bad].sort((a, b) => a - b);
}

/** 连线 → core 的组。没连上的节各自一组（不合并）。只对没有问题的连线使用 */
export function groupsFromLinks(
  links: Link[],
  empties: Empties,
  counts: { first: number; second: number },
): ChapterGroup[] {
  const comps = components(links, empties);
  const usedFirst = new Set(comps.flatMap((c) => c.first));
  const usedSecond = new Set(comps.flatMap((c) => c.second));
  const groups: ChapterGroup[] = [
    ...comps.map((c) => ({ en: c.first, zh: c.second })),
    ...range(counts.first)
      .filter((i) => !usedFirst.has(i))
      .map((i) => ({ en: [i], zh: [] })),
    ...range(counts.second)
      .filter((j) => !usedSecond.has(j))
      .map((j) => ({ en: [], zh: [j] })),
  ];
  return inBookOrder(groups);
}

/** i 紧挨着 ids 这一段（中间只隔着没有正文的节也算） */
function adjacent(i: number, ids: number[], empty: boolean[]): boolean {
  const touches = (from: number, step: number) => {
    for (let k = from + step; k >= 0 && k < empty.length; k += step) {
      if (k === i) return true;
      if (!empty[k]) return false;
    }
    return false;
  };
  return touches(ids[0]!, -1) || touches(ids.at(-1)!, 1);
}

/**
 * 配一对：第一本第 i 节和第二本第 j 节，最后一次操作说了算。
 * - 默认是"换搭档"：两节原来各自的配对都去掉，成为新的一对
 * - 只有一种情况是"加入"：其中一节原来没配对，并且紧挨着另一节所在的那一组，就并进那一组（多对一）
 * 然后去掉和它交叉的连线；它所在的组如果有一边不连续，就去掉离它最远的旧连线，直到连续为止。
 * 所以结果永远是合法的章节表。dropped 是去掉的、不涉及这两节的旧连线条数，界面上告诉用户
 */
export function linkPair(
  links: Link[],
  first: number,
  second: number,
  empties: Empties,
): { links: Link[]; dropped: number } {
  const comps = components(links, empties);
  const ofFirst = comps.find((c) => c.first.includes(first));
  const ofSecond = comps.find((c) => c.second.includes(second));
  const join =
    (ofFirst === undefined &&
      ofSecond !== undefined &&
      adjacent(first, ofSecond.first, empties.first)) ||
    (ofSecond === undefined &&
      ofFirst !== undefined &&
      adjacent(second, ofFirst.second, empties.second));
  const crosses = (l: Link) =>
    (l.first < first && l.second > second) || (l.first > first && l.second < second);
  const added = { first, second };
  let next = [
    ...links.filter((l) => !crosses(l) && (join || (l.first !== first && l.second !== second))),
    added,
  ];
  for (;;) {
    const comp = components(next, empties).find(
      (c) => c.first.includes(first) && c.second.includes(second),
    )!;
    if (consecutive(comp.first) && consecutive(comp.second)) break;
    const distance = (l: Link) => Math.abs(l.first - first) + Math.abs(l.second - second);
    const farthest = next
      .filter((l) => l !== added && comp.first.includes(l.first))
      .reduce((a, b) => (distance(b) > distance(a) ? b : a));
    next = next.filter((l) => l !== farthest);
  }
  const dropped = links.filter(
    (l) =>
      l.first !== first &&
      l.second !== second &&
      !next.some((m) => m.first === l.first && m.second === l.second),
  ).length;
  return { links: next, dropped };
}

/** 拆开一整组：组里所有连线都去掉，两边都变成不合并 */
export function unpairGroup(links: Link[], comp: Component): Link[] {
  return links.filter((l) => !comp.first.includes(l.first));
}

/** 和预填相比，搭档变了的节数（两本书的节加起来）。统计用户改了多少，不看顺序 */
export function changedSections(before: Link[], after: Link[]): number {
  const partners = (links: Link[]) => {
    const map = new Map<string, number[]>();
    const add = (key: string, partner: number) => map.set(key, [...(map.get(key) ?? []), partner]);
    for (const { first, second } of links) {
      add(`first ${first}`, second);
      add(`second ${second}`, first);
    }
    return map;
  };
  const a = partners(before);
  const b = partners(after);
  const same = (x: number[] = [], y: number[] = []) =>
    x.length === y.length && x.every((n) => y.includes(n));
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].filter((key) => !same(a.get(key), b.get(key))).length;
}
