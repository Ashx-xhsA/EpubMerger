// 找出书的封面图片。只看 OPF 里的声明，不翻正文：正文第一页的图常常是出版社标志，找错比找不到更糟。

import type { Book, ManifestItem } from './types.ts';

export interface Cover {
  /** zip 内完整路径，用 book.readBytes 读 */
  path: string;
  mediaType: string;
}

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/**
 * 按顺序试：
 * 1. ePub 3：manifest 里 properties 含 cover-image 的项
 * 2. ePub 2：<meta name="cover" content="X"/>，X 按 manifest id 查，查不到再按文件名查
 * 3. 兜底：id 或文件名含 cover 的图片
 * 只认 zip 里真的有的图片；都没有就返回 null
 */
export function findCover(book: Book): Cover | null {
  const files = new Set(book.files);
  const images = [...book.manifest.values()].filter(
    (item) => IMAGE_TYPES.has(item.mediaType) && files.has(item.href),
  );
  const toCover = (item: ManifestItem | undefined): Cover | null =>
    item === undefined ? null : { path: item.href, mediaType: item.mediaType };

  const declared = images.find((item) => item.properties.includes('cover-image'));
  if (declared !== undefined) return toCover(declared);

  const { coverId } = book.metadata;
  if (coverId !== null) {
    const byId = images.find((item) => item.id === coverId);
    const byName = images.find((item) => basename(item.href) === basename(coverId));
    if (byId !== undefined || byName !== undefined) return toCover(byId ?? byName);
  }

  return toCover(
    images.find(
      (item) =>
        item.id.toLowerCase().includes('cover') ||
        basename(item.href).toLowerCase().includes('cover'),
    ),
  );
}
