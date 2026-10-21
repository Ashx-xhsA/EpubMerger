import type { LegalStrings } from './legal-en.ts';

export const legalZh: LegalStrings = {
  updated: '最后更新：2026 年 10 月 20 日',
  back: '返回 EpubMerger',

  privacy: {
    title: '隐私说明',
    sections: [
      {
        heading: '你的书只留在你的电脑上',
        body: ['EpubMerger 读取书籍、对齐、生成新书，全部在浏览器里完成。文件不会上传到任何地方。'],
      },
      {
        heading: '联系我们',
        body: ['有疑问或顾虑，请在 GitHub 上提一个 issue（链接在页面底部）。'],
      },
    ],
  },

  terms: {
    title: '使用条款',
    sections: [
      {
        heading: '只处理你拥有的书',
        body: [
          '请只用 EpubMerger 处理你合法拥有、没有 DRM 的书。有 DRM 的文件工具会拒绝处理，我们也不提供、不链接任何去除 DRM 的方法。',
        ],
      },
      {
        heading: '仅限个人使用',
        body: [
          '生成的双语书只供你自己阅读，请不要分享、出售或公开发布；原书的版权仍然属于出版方。',
        ],
      },
      {
        heading: '不提供书',
        body: ['我们不提供、不托管、也不提供任何书的下载链接。'],
      },
      {
        heading: '不作保证',
        body: [
          'EpubMerger 免费、按现状提供。段落对齐有时会出错，有些阅读器显示的效果也可能不同。请保留原来的文件。',
        ],
      },
      {
        heading: '修改',
        body: ['我们可能会更新这些条款和隐私说明，以页面顶部的日期为准。'],
      },
    ],
  },
};
