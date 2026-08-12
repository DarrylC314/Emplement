import { describe, it, expect } from 'vitest';
import { colors } from '@/styles/tokens';

describe('design tokens', () => {
  it('exposes a primary color', () => {
    expect(colors.primary).toBe('#0B4F9E');
  });
});
