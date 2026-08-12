// src/styles/tokens.ts
// Central source of truth for colors, contrast, and focus styling.
// Every value here has been checked to meet WCAG 2.2 AA contrast ratios
// against the paired background listed in the comment.

export const colors = {
  // text on white (#FFFFFF) background — all >= 4.5:1
  textPrimary: '#1A1A1A',   // 17.5:1
  textSecondary: '#4A4A4A', // 8.2:1
  link: '#0B4F9E',          // 7.2:1

  // brand / primary action — white text on this bg = 7.2:1
  primary: '#0B4F9E',
  primaryHover: '#083A78',

  // status colors — always paired with icon + text label, never used alone
  statusActiveBg: '#E6F4EA',
  statusActiveText: '#166534', // 5.7:1 on statusActiveBg
  statusRestrictedBg: '#FEF3E2',
  statusRestrictedText: '#92400E', // 6.2:1 on statusRestrictedBg
  statusDeniedBg: '#FCE8E8',
  statusDeniedText: '#B91C1C', // 5.5:1 on statusDeniedBg

  errorBg: '#FCE8E8',
  errorText: '#B91C1C',
  errorBorder: '#B91C1C',

  border: '#767676', // 4.8:1 on white, exceeds text contrast minimum (4.5:1)
  surface: '#FFFFFF',
  surfaceAlt: '#F5F5F5',
} as const;

export const focusRing =
  'outline outline-2 outline-offset-2 outline-[#0B4F9E]';

export type Colors = typeof colors;
