import { describe, expect, it } from 'vitest';
import type { Block, Region } from '../extract/types.ts';
import { detectLanguage, evenSample } from './detect.ts';

function block(text: string, region: Region = 'body', kind: Block['kind'] = 'para'): Block {
  return {
    kind,
    text,
    html: '',
    range: [0, 0],
    file: 'text.xhtml',
    ids: [],
    className: '',
    region,
  };
}

/** 一本由这些段落轮流重复 n 次组成的书 */
function book(texts: string[], n = 20, region: Region = 'body'): Block[] {
  return Array.from({ length: n }, (_, i) => block(texts[i % texts.length]!, region));
}

const EN = [
  'The house was quiet in the early morning, and the light came slowly through the tall windows of the hall, falling on the statues one by one.',
  'She had kept a journal for many years, writing down everything she saw and heard, because she was afraid that one day she would forget it all.',
];
const FR = [
  "La maison était silencieuse au petit matin, et la lumière entrait lentement par les hautes fenêtres de la salle, tombant sur les statues l'une après l'autre.",
  "Elle avait tenu un journal pendant de nombreuses années, notant tout ce qu'elle voyait et entendait, parce qu'elle avait peur d'oublier un jour.",
];
const ZH = [
  '清晨的房子很安静，光线慢慢地从大厅高高的窗户照进来，一个接一个地落在雕像上。',
  '她写了很多年的日记，把看到和听到的一切都记下来，因为她害怕有一天会把这些都忘了。',
];
const ZH_HANT = [
  '清晨的房子很安靜，光線慢慢地從大廳高高的窗戶照進來，一個接一個地落在雕像上。',
  '她寫了很多年的日記，把看到和聽到的一切都記下來，因為她害怕有一天會把這些都忘了。',
];
const JA = [
  '早朝の家は静かで、光は広間の高い窓からゆっくりと差し込み、彫像の上に一つずつ落ちていった。',
  '彼女は何年も日記をつけていて、見たことや聞いたことをすべて書き留めていた。',
];

describe('detectLanguage', () => {
  it('detects English, French, Simplified and Traditional Chinese, and Japanese books', () => {
    expect(detectLanguage(book(EN)).language).toEqual({ kind: 'single', lang: 'en' });
    expect(detectLanguage(book(FR)).language).toEqual({ kind: 'single', lang: 'fr' });
    expect(detectLanguage(book(ZH)).language).toEqual({ kind: 'single', lang: 'zh-Hans' });
    expect(detectLanguage(book(ZH_HANT)).language).toEqual({ kind: 'single', lang: 'zh-Hant' });
    expect(detectLanguage(book(JA)).language).toEqual({ kind: 'single', lang: 'ja' });
  });

  it('is uncertain about a book that is already bilingual', () => {
    const interleaved = book([EN[0]!, ZH[0]!, EN[1]!, ZH[1]!]);
    expect(detectLanguage(interleaved).language).toEqual({ kind: 'uncertain' });
  });

  it('ignores an all-English copyright page, index and headings in a Chinese book', () => {
    const blocks = [
      ...book(EN, 30, 'copyright'),
      ...book(EN, 30, 'index'),
      ...Array.from({ length: 30 }, () => block(EN[0]!, 'body', 'heading')),
      ...book(ZH, 20),
    ];
    const { language, stats } = detectLanguage(blocks);
    expect(language).toEqual({ kind: 'single', lang: 'zh-Hans' });
    expect(stats.paragraphs.latin).toBe(0);
  });

  it('keeps a Chinese book Chinese when some paragraphs are English quotations', () => {
    const blocks = [...book(ZH, 18), ...book(EN, 2)];
    expect(detectLanguage(blocks).language).toEqual({ kind: 'single', lang: 'zh-Hans' });
  });

  it('is uncertain when nothing votes or no language has a clear majority', () => {
    expect(detectLanguage(book(['* * *', 'Chapter 1'])).language).toEqual({ kind: 'uncertain' });
    expect(detectLanguage([]).language).toEqual({ kind: 'uncertain' });
    // 英 60%、中 20%、日 20%：没有一种到 70%
    const blocks = [...book(EN, 12), ...book(ZH, 4), ...book(JA, 4)];
    expect(detectLanguage(blocks).language).toEqual({ kind: 'uncertain' });
  });

  it('reports the statistics it decided from', () => {
    const { stats } = detectLanguage([...book(ZH, 10), block('* * *')]);
    expect(stats.paragraphs).toMatchObject({ zh: 10, short: 1 });
    expect(stats.languages).toEqual({ 'zh-Hans': 10 });
    expect(stats.variants.simplified).toBeGreaterThan(0);
    expect(stats.variants.traditional).toBe(0);
  });

  it('samples only long alphabetic paragraphs when there are some', () => {
    const { stats } = detectLanguage([...book(EN, 10), block('Oui, bien sûr, mon ami.')]);
    expect(stats.samples).toEqual({ latin: { en: 10 } });
    // 短的法文段落也按英文的比例算进英文
    expect(stats.languages).toEqual({ en: 11 });
  });
});

describe('evenSample', () => {
  it('returns everything when there are few items', () => {
    expect(evenSample([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it('spreads picks over the whole list', () => {
    const picked = evenSample(
      Array.from({ length: 1000 }, (_, i) => i),
      4,
    );
    expect(picked).toEqual([0, 250, 500, 750]);
  });
});
