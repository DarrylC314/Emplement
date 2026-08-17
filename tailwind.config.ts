// tailwind.config.ts
import type { Config } from 'tailwindcss';
import { colors } from './src/styles/tokens';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: colors.primary,
        'primary-hover': colors.primaryHover,
        'text-primary': colors.textPrimary,
        'text-secondary': colors.textSecondary,
        link: colors.link,
        'status-active-bg': colors.statusActiveBg,
        'status-active-text': colors.statusActiveText,
        'status-restricted-bg': colors.statusRestrictedBg,
        'status-restricted-text': colors.statusRestrictedText,
        'status-denied-bg': colors.statusDeniedBg,
        'status-denied-text': colors.statusDeniedText,
        'status-reevaluation-bg': colors.statusReevaluationBg,
        'status-reevaluation-text': colors.statusReevaluationText,
        'error-bg': colors.errorBg,
        'error-text': colors.errorText,
        'error-border': colors.errorBorder,
        border: colors.border,
        surface: colors.surface,
        'surface-alt': colors.surfaceAlt,
      },
    },
  },
  plugins: [],
};

export default config;
