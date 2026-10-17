// 简体还是繁体：数"繁体专用字"和对应的"简体专用字"各出现几次。
//
// 只收两边不会混用的字。"後/后"不收，因为繁体里"皇后"也写"后"；"裡/里"不收，繁体里"公里"也写"里"。

/** 每两个字一对：繁体、简体 */
const PAIRS =
  '這这們们個个來来說说為为與与時时會会對对' +
  '國国學学開开關关現现發发經经點点過过還还' +
  '進进動动種种從从當当樣样問问間间頭头長长' +
  '見见東东車车門门話话讓让認认體体實实寫写' +
  '聽听覺觉變变應应機机氣气電电書书無无歲岁' +
  '愛爱處处給给聲声號号師师雖虽嗎吗謝谢讀读';

/** 字 → 它是繁体专用字还是简体专用字 */
export const VARIANT_CHARS: ReadonlyMap<string, 'traditional' | 'simplified'> = (() => {
  const map = new Map<string, 'traditional' | 'simplified'>();
  for (let i = 0; i < PAIRS.length; i += 2) {
    map.set(PAIRS[i]!, 'traditional');
    map.set(PAIRS[i + 1]!, 'simplified');
  }
  return map;
})();

/** 一段文字里繁体专用字、简体专用字各有几个 */
export function countVariants(text: string): { traditional: number; simplified: number } {
  const counts = { traditional: 0, simplified: 0 };
  for (const ch of text) {
    const v = VARIANT_CHARS.get(ch);
    if (v !== undefined) counts[v]++;
  }
  return counts;
}
