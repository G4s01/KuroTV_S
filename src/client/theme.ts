/**
 * KuroSync OLED Design System Tokens & Helper Styles
 * Matches _reference/kurotv-mobile/unistyles.ts for pitch-black OLED displays.
 */

export const FONT_MONO =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export const oledTheme = {
  colors: {
    background: '#000000',
    card: '#0D0D0D',
    surface: '#121212',
    surfaceSubtle: '#171717',
    surfaceElevated: '#1E1E1E',
    border: '#262626',
    borderLight: '#333333',
    borderActive: '#E50914',
    text: '#FFFFFF',
    textSecondary: '#A3A3A3',
    textMuted: '#737373',
    primary: '#E50914',
    primaryHover: '#F40612',
    accent: '#E50914',
    success: '#10B981', // For [IN PARI] badge
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',
    overlay: 'rgba(0, 0, 0, 0.85)',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '20px',
    xl: '24px',
    xxl: '32px',
  },
  radius: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    full: '9999px',
  },
  typography: {
    fontFamily: FONT_MONO,
  },
} as const;

export type OLEDTheme = typeof oledTheme;

export const commonStyles = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '0 20px',
    width: '100%',
  },
  card: {
    backgroundColor: oledTheme.colors.card,
    border: `1px solid ${oledTheme.colors.border}`,
    borderRadius: oledTheme.radius.md,
    padding: '20px',
  },
  input: {
    width: '100%',
    backgroundColor: '#050505',
    color: oledTheme.colors.text,
    border: `1px solid ${oledTheme.colors.border}`,
    borderRadius: oledTheme.radius.sm,
    padding: '10px 14px',
    fontSize: '14px',
    fontFamily: FONT_MONO,
    outline: 'none',
    transition: 'border-color 0.15s ease',
  },
  monoHeading: {
    fontFamily: FONT_MONO,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    fontWeight: 700,
  },
};
