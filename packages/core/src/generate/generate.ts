// 生成双语 ePub 的入口：骨架书 + 配好的段落 → 新 ePub 的字节。
// 骨架书的文件全部原样复制，只改有插入的 XHTML、OPF、NCX，再加一个 bilingual.css。

import { dirname, relativePath } from '../epub/path.ts';
import type { Book } from '../epub/types.ts';
import type { Block } from '../extract/types.ts';
import type { BlockPair } from '../paragraphs/align-book.ts';
import { LEFT_CLASS, orphanRow, RIGHT_CLASS, ROW_CLASS, rowChecker, rowEdits } from './columns.ts';
import { applyEdits, insertAt, type Edit } from './edit.ts';
import {
  INSERT_CLASS,
  insertedElement,
  placeBlocks,
  stylesheetEdit,
  utf8Declaration,
  type DropReason,
  type Placement,
} from './inject.ts';
import { modifiedTime, updateNcxUid, updateOpf } from './opf.ts';
import { packageEpub } from './package.ts';

/**
 * 保守的写法：只用字号、边距和最基本的表格（墨水屏上颜色没用），具体数值等 0.12 真机看过再调。
 * 两栏时格子里的译文不缩小字号、不加上边距
 */
export const BILINGUAL_CSS = `.${INSERT_CLASS} {
  font-size: 0.92em;
  margin-top: 0.3em;
  margin-bottom: 1em;
}
table.${ROW_CLASS} {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 0.8em 0;
}
table.${ROW_CLASS} td {
  width: 50%;
  vertical-align: top;
}
td.${LEFT_CLASS} {
  padding: 0 0.75em 0 0;
}
td.${RIGHT_CLASS} {
  padding: 0 0 0 0.75em;
}
table.${ROW_CLASS} .${INSERT_CLASS} {
  font-size: 1em;
  margin-top: 0;
}
`;

/** 把 placements 按来自哪一对分组，保持顺序 */
function byPair(placements: Placement[]): Placement[][] {
  const groups: Placement[][] = [];
  for (const p of placements) {
    const last = groups.at(-1);
    if (last !== undefined && last[0]!.pair === p.pair) last.push(p);
    else groups.push([p]);
  }
  return groups;
}

export interface GenerateInput {
  skeleton: Book;
  /** 两本书的语言（BCP 47，来自 detectLanguage），写进 lang 和 dc:language */
  skeletonLang: string;
  otherLang: string;
  pairs: BlockPair[];
  /** 另一本的段落放在骨架段落前面（两栏时放左栏） */
  otherFirst: boolean;
  /** stacked：上下交替（默认）；columns：左右两栏，每对一个小表格 */
  layout?: 'stacked' | 'columns';
  /** 新书名。给人看的文案由调用方决定 */
  title: string;
  /** 测试时固定用 */
  uuid?: string;
  now?: Date;
}

export type GenerateWarningCode =
  | 'FONT_OBFUSCATION' // 有 encryption.xml：混淆字体的密钥是 identifier，换了 UUID 字体会坏
  | 'NO_HEAD' // XHTML 没有 </head>，加不了 css 链接
  | 'EMPTY_BLOCK'; // 另一本的段落清理后没有内容（如只有图片），没插

export interface GenerateReport {
  /** 插进去的段落数 */
  inserted: number;
  /** 两栏时包成表格的对数 */
  rows: number;
  /** 两栏时包不成表格、退回上下交替的对数 */
  columnFallbacks: number;
  /** 没插进去的段落：原因和开头几个字 */
  dropped: { reason: DropReason; text: string }[];
  /** 改过的文件（zip 内路径） */
  changedFiles: string[];
  warnings: { code: GenerateWarningCode; message: string }[];
}

export type GenerateResult =
  { ok: true; bytes: Uint8Array; report: GenerateReport } | { ok: false; message: string };

const preview = (text: string) => (text.length > 30 ? `${text.slice(0, 30)}…` : text);

/** 在 OPF 所在文件夹里找一个没被占用的 css 文件名 */
function cssPath(book: Book): string {
  const dir = dirname(book.opfPath);
  const taken = new Set(book.files.map((f) => f.toLowerCase()));
  for (let n = 0; ; n++) {
    const name = n === 0 ? 'bilingual.css' : `bilingual-${n}.css`;
    const path = dir === '' ? name : `${dir}/${name}`;
    if (!taken.has(path.toLowerCase())) return path;
  }
}

export function generateBilingual(input: GenerateInput): GenerateResult {
  const { skeleton: book } = input;
  const epub3 = book.version.startsWith('3');
  const report: GenerateReport = {
    inserted: 0,
    rows: 0,
    columnFallbacks: 0,
    dropped: [],
    changedFiles: [],
    warnings: [],
  };
  if (book.files.some((f) => f.toLowerCase() === 'meta-inf/encryption.xml')) {
    report.warnings.push({
      code: 'FONT_OBFUSCATION',
      message:
        'META-INF/encryption.xml present; obfuscated fonts may break with the new identifier',
    });
  }

  const { placements, dropped } = placeBlocks(input.pairs, input.otherFirst);
  report.dropped = dropped.map((d) => ({ reason: d.reason, text: preview(d.block.text) }));

  // 按文件收集修改。placements 按对的顺序排，同一位置的插入也就按书里的顺序排
  const sources = new Map<string, string>();
  const edits = new Map<string, Edit[]>();
  const checkers = new Map<string, (blocks: Block[]) => boolean>();
  const columns = input.layout === 'columns';
  for (const group of byPair(placements)) {
    const { file, at, anchor, pair } = group[0]!;
    let source = sources.get(file);
    if (source === undefined) {
      const text = book.readText(file);
      if (text === null) return { ok: false, message: `cannot read ${file}` };
      source = text;
      sources.set(file, source);
      edits.set(file, []);
    }
    const fileEdits = edits.get(file)!;
    const elements: string[] = [];
    for (const p of group) {
      const element = insertedElement(
        source.slice(...anchor.range),
        p.block,
        input.otherLang,
        epub3,
      );
      if (element === null)
        report.warnings.push({ code: 'EMPTY_BLOCK', message: preview(p.block.text) });
      else elements.push(element);
    }
    if (elements.length === 0) continue;
    report.inserted += elements.length;

    if (columns) {
      const skeleton = input.pairs[pair]!.skeleton;
      if (skeleton.length === 0) {
        fileEdits.push(orphanRow(at, elements, input.otherFirst));
        report.rows++;
        continue;
      }
      let canWrap = checkers.get(file);
      if (canWrap === undefined) {
        canWrap = rowChecker(source);
        checkers.set(file, canWrap);
      }
      if (canWrap(skeleton)) {
        fileEdits.push(...rowEdits(skeleton, elements, input.otherFirst));
        report.rows++;
        continue;
      }
      report.columnFallbacks++;
    }
    fileEdits.push(...elements.map((e) => insertAt(at, e)));
  }

  const css = cssPath(book);
  const out = new Map<string, Uint8Array>();
  for (const path of book.files) {
    const bytes = book.readBytes(path);
    if (bytes !== null) out.set(path, bytes);
  }
  const encoder = new TextEncoder();
  const write = (path: string, text: string) => {
    out.set(path, encoder.encode(text));
    report.changedFiles.push(path);
  };

  for (const [file, fileEdits] of edits) {
    const source = sources.get(file)!;
    const link = stylesheetEdit(source, relativePath(dirname(file), css));
    if (link === null) report.warnings.push({ code: 'NO_HEAD', message: file });
    else fileEdits.push(link);
    write(file, utf8Declaration(applyEdits(source, fileEdits)));
  }

  const identifier = `urn:uuid:${input.uuid ?? crypto.randomUUID()}`;
  const opfSource = book.readText(book.opfPath);
  const opf =
    opfSource === null
      ? null
      : updateOpf(opfSource, epub3, {
          title: input.title,
          identifier,
          languages: [input.skeletonLang, input.otherLang],
          css: {
            id: uniqueId(book, 'bilingual-css'),
            href: relativePath(dirname(book.opfPath), css),
          },
          modified: modifiedTime(input.now ?? new Date()),
        });
  if (opf === null) return { ok: false, message: `cannot update ${book.opfPath}` };
  write(book.opfPath, utf8Declaration(opf));

  for (const item of book.manifest.values()) {
    if (item.mediaType !== 'application/x-dtbncx+xml') continue;
    const ncx = book.readText(item.href);
    if (ncx !== null) write(item.href, utf8Declaration(updateNcxUid(ncx, identifier)));
  }

  out.set(css, encoder.encode(BILINGUAL_CSS));
  report.changedFiles.push(css);
  return { ok: true, bytes: packageEpub(out), report };
}

/** manifest 里没用过的 id */
function uniqueId(book: Book, base: string): string {
  let id = base;
  for (let n = 1; book.manifest.has(id); n++) id = `${base}-${n}`;
  return id;
}
