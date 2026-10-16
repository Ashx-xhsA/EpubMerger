export const CORE_VERSION = '0.0.0';

/** 0.1 工具链冒烟测试用的占位函数，0.3 开始会被真正的解析逻辑取代。 */
export function describeMerge(enPath: string, zhPath: string): string {
  return `merge ${enPath} + ${zhPath}`;
}
