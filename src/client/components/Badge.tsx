import React from 'react';
import { oledTheme, FONT_MONO } from '../theme';

export type BadgeVariant =
  | 'default'
  | 'in-pari'
  | 'success'
  | 'warning'
  | 'danger'
  | 'accent'
  | 'info';

interface BadgeProps {
  children?: React.ReactNode;
  variant?: BadgeVariant;
  style?: React.CSSProperties;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  style,
}) => {
  let background: string = 'rgba(255, 255, 255, 0.08)';
  let color: string = oledTheme.colors.textSecondary;
  let borderColor: string = oledTheme.colors.border;

  switch (variant) {
    case 'in-pari':
      background = 'rgba(16, 185, 129, 0.15)';
      color = '#10B981';
      borderColor = '#10B981';
      break;
    case 'success':
      background = 'rgba(16, 185, 129, 0.15)';
      color = oledTheme.colors.success;
      borderColor = oledTheme.colors.success;
      break;
    case 'warning':
      background = 'rgba(245, 158, 11, 0.15)';
      color = oledTheme.colors.warning;
      borderColor = oledTheme.colors.warning;
      break;
    case 'danger':
      background = 'rgba(239, 68, 68, 0.15)';
      color = oledTheme.colors.error;
      borderColor = oledTheme.colors.error;
      break;
    case 'accent':
      background = 'rgba(229, 9, 20, 0.15)';
      color = oledTheme.colors.primary;
      borderColor = oledTheme.colors.primary;
      break;
    case 'info':
      background = 'rgba(59, 130, 246, 0.15)';
      color = oledTheme.colors.info;
      borderColor = oledTheme.colors.info;
      break;
    default:
      background = 'rgba(255, 255, 255, 0.08)';
      color = oledTheme.colors.textSecondary;
      borderColor = oledTheme.colors.border;
  }

  const defaultContent = variant === 'in-pari' && !children ? 'IN PARI' : children;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2px 8px',
        borderRadius: oledTheme.radius.xs,
        backgroundColor: background,
        color,
        border: `1px solid ${borderColor}`,
        fontFamily: FONT_MONO,
        fontSize: '11px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {defaultContent}
    </span>
  );
};
