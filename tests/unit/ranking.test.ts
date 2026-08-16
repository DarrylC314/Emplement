import { describe, it, expect } from 'vitest';
import { scoreByTagOverlap } from '@/lib/ranking';

describe('scoreByTagOverlap', () => {
  it('excludes items with no tag overlap', () => {
    const result = scoreByTagOverlap(['SALES'], [
      { id: 'a', tags: ['CONSTRUCTION'] },
      { id: 'b', tags: ['SALES'] },
    ]);
    expect(result.map((r) => r.id)).toEqual(['b']);
  });

  it('sorts by overlap count descending', () => {
    const result = scoreByTagOverlap(['SALES', 'OFFICE_ADMINISTRATIVE', 'MANAGEMENT'], [
      { id: 'one-match', tags: ['SALES'] },
      { id: 'three-match', tags: ['SALES', 'OFFICE_ADMINISTRATIVE', 'MANAGEMENT'] },
      { id: 'two-match', tags: ['SALES', 'MANAGEMENT'] },
    ]);
    expect(result.map((r) => r.id)).toEqual(['three-match', 'two-match', 'one-match']);
  });

  it('keeps insertion order for tied scores', () => {
    const result = scoreByTagOverlap(['SALES'], [
      { id: 'first', tags: ['SALES'] },
      { id: 'second', tags: ['SALES'] },
    ]);
    expect(result.map((r) => r.id)).toEqual(['first', 'second']);
  });

  it('caps results at 5', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ id: `item-${i}`, tags: ['SALES'] }));
    const result = scoreByTagOverlap(['SALES'], items);
    expect(result).toHaveLength(5);
  });

  it('returns an empty array when the viewer has no tags', () => {
    const result = scoreByTagOverlap([], [{ id: 'a', tags: ['SALES'] }]);
    expect(result).toEqual([]);
  });

  it('returns an empty array when no items have tags', () => {
    const result = scoreByTagOverlap(['SALES'], [{ id: 'a', tags: [] }]);
    expect(result).toEqual([]);
  });
});
