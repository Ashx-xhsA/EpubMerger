// 隐私说明、使用条款两页的正文。legal-zh.ts 的类型就是这里的类型
// 统计事件改了（analytics.ts），这里的"我们记录什么"要跟着改

/** 一段文字，或者一组列表项 */
type Block = string | string[];

interface LegalDoc {
  title: string;
  sections: { heading: string; body: Block[] }[];
}

export const legalEn = {
  updated: 'Last updated: October 19, 2026',
  back: 'Back to EpubMerger',

  privacy: {
    title: 'Privacy',
    sections: [
      {
        heading: 'Your books stay on your computer',
        body: [
          'EpubMerger reads, aligns and generates books entirely inside your browser. Your files are never uploaded: we have no server that could receive them.',
        ],
      },
      {
        heading: 'What we count',
        body: [
          'To see whether the tool works, we count a few anonymous events with Umami, a privacy-friendly analytics service:',
          [
            'visits: page, referring site, browser, device type and country (from your IP address, which is not stored)',
            'a book finished loading: whether it worked or which error occurred, its detected language, and its size range',
            'the body range was confirmed: whether you changed the guessed start or end',
            'merging started: how many sections you re-paired in the chapter table, and the layout',
            'merging finished, failed or was cancelled: how long it took, the books’ length range, the error code or the stage it was cancelled at',
            'a download: whether this is the 1st, 2nd–5th, or 6th-or-later book merged in this browser',
          ],
          'We never record book titles, file names, chapter titles or any text from your books. Umami does not use cookies and cannot tell who you are or link your visits on different days.',
        ],
      },
      {
        heading: 'Error reports',
        body: [
          'If the page hits an error we did not expect, it sends a report to Sentry: the error message and where in our code it happened, plus your browser and operating system. Reports do not include anything from your books or what you clicked.',
          'Known problems, such as a file that is not an ePub or is DRM-protected, are not reported; they are only counted as error codes above.',
        ],
      },
      {
        heading: 'Stored in your browser',
        body: [
          'Two things are saved in your browser’s local storage and never leave it on their own: your interface language, and how many books you have merged here (used for the download count above). Clearing your site data removes both.',
        ],
      },
      {
        heading: 'Services we use',
        body: [
          [
            'Cloudflare Pages: hosts this website',
            'Umami Cloud: anonymous usage counts',
            'Sentry: error reports',
          ],
          'If you use an ad or tracker blocker, the last two may be blocked. The tool works the same either way.',
        ],
      },
      {
        heading: 'Contact',
        body: [
          'Questions or concerns: please open an issue on GitHub (link at the bottom of the page).',
        ],
      },
    ],
  } satisfies LegalDoc,

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
        body: ['We do not offer, host or link to any books. You bring both editions yourself.'],
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
  } satisfies LegalDoc,
};

export type LegalStrings = typeof legalEn;
