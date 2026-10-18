// 按字符位置改字符串：把 [start, end) 换成 text。start === end 就是插入。
// 生成 ePub 时只在原文里"切开、塞进去"，其余部分一个字节都不变（trade-off 025）。

export interface Edit {
  start: number;
  end: number;
  text: string;
}

/** 插入：在 at 处塞进 text */
export function insertAt(at: number, text: string): Edit {
  return { start: at, end: at, text };
}

/**
 * 一次做完所有修改。各处修改不能重叠；同一位置的多个插入按给出的顺序排。
 * 从前往后拼一个新字符串，所以前面的修改不会挪动后面的位置
 */
export function applyEdits(text: string, edits: Edit[]): string {
  const sorted = edits.map((e, i) => ({ e, i })).sort((a, b) => a.e.start - b.e.start || a.i - b.i);
  let out = '';
  let pos = 0;
  for (const { e } of sorted) {
    if (e.start < pos) throw new Error(`overlapping edits at ${e.start}`);
    out += text.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  return out + text.slice(pos);
}
