import type { TagCategoryValue } from '@/lib/tagOptions';

export function scoreByTagOverlap<T extends { tags: TagCategoryValue[] }>(
  viewerTags: TagCategoryValue[],
  items: T[]
): T[] {
  return items
    .map((item) => ({
      item,
      score: item.tags.filter((t) => viewerTags.includes(t)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ item }) => item);
}
