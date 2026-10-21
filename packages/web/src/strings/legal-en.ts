// 隐私说明、使用条款两页的正文。legal-zh.ts 的类型就是这里的类型

/** 一段文字，或者一组列表项 */
type Block = string | string[];

interface LegalDoc {
  title: string;
  sections: { heading: string; body: Block[] }[];
}

export interface LegalStrings {
  updated: string;
  back: string;
  privacy: LegalDoc;
  terms: LegalDoc;
}

export const legalEn: LegalStrings = {
  updated: 'Last updated: October 20, 2026',
  back: 'Back to EpubMerger',

  privacy: {
    title: 'Privacy',
    sections: [
      {
        heading: 'Your books stay on your computer',
        body: [
          'EpubMerger reads, aligns and generates books entirely in your browser. Your files are never uploaded anywhere.',
        ],
      },
      {
        heading: 'Contact',
        body: [
          'Questions or concerns: please open an issue on GitHub (link at the bottom of the page).',
        ],
      },
    ],
  },

  terms: {
    title: 'Terms of use',
    sections: [
      {
        heading: 'Books you own',
        body: [
          'Only use EpubMerger with books you legally own and that are free of DRM. The tool refuses DRM-protected files, and we do not provide or link to any way of removing DRM.',
        ],
      },
      {
        heading: 'Personal use only',
        body: [
          'The bilingual books you create are for your own reading. Please do not share, sell or publish them; the original books are still under their publishers’ copyright.',
        ],
      },
      {
        heading: 'No books provided',
        body: ['We do not offer, host or provide download links for any books.'],
      },
      {
        heading: 'No guarantees',
        body: [
          'EpubMerger is provided as is, for free. Paragraph alignment can be wrong in places, and some readers may display the result differently. Keep your original files.',
        ],
      },
      {
        heading: 'Changes',
        body: [
          'We may update these terms and the privacy page; the date at the top shows the latest version.',
        ],
      },
    ],
  },
};
