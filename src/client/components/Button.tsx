import React, { useState } from 'react';
import { oledTheme, FONT_MONO } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  style,
  ...props
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isActive, setIsActive] = useState(false);

  const isDisabled = disabled || loading;

  let bg: string = oledTheme.colors.primary;
  let textColor: string = '#FFFFFF';
  let borderColor: string = oledTheme.colors.primary;

  switch (variant) {
    case 'primary':
      bg = isActive
        ? '#B80710'
        : isHovered && !isDisabled
        ? oledTheme.colors.primaryHover
        : oledTheme.colors.primary;
      textColor = '#FFFFFF';
      borderColor = bg;
      break;
    case 'secondary':
      bg = isActive
        ? '#222222'
        : isHovered && !isDisabled
        ? '#1C1C1C'
        : oledTheme.colors.surface;
      textColor = oledTheme.colors.text;
      borderColor = oledTheme.colors.border;
      break;
    case 'danger':
      bg = isActive
        ? '#991B1B'
        : isHovered && !isDisabled
        ? '#DC2626'
        : 'rgba(239, 68, 68, 0.15)';
      textColor = isHovered ? '#FFFFFF' : oledTheme.colors.error;
      borderColor = oledTheme.colors.error;
      break;
    case 'ghost':
      bg = isHovered && !isDisabled ? 'rgba(255, 255, 255, 0.08)' : 'transparent';
      textColor = oledTheme.colors.textSecondary;
      borderColor = 'transparent';
      break;
  }

  let padding = '8px 16px';
  let fontSize = '13px';
  if (size === 'sm') {
    padding = '5px 10px';
    fontSize = '11px';
  } else if (size === 'lg') {
    padding = '12px 24px';
    fontSize = '15px';
  }

  return (
    <button
      disabled={isDisabled}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsActive(false);
      }}
      onMouseDown={() => setIsActive(true)}
      onMouseUp={() => setIsActive(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding,
        fontSize,
        fontFamily: FONT_MONO,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        backgroundColor: bg,
        color: textColor,
        border: `1px solid ${borderColor}`,
        borderRadius: oledTheme.radius.sm,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.6 : 1,
        transition: 'all 0.15s ease',
        outline: 'none',
        ...style,
      }}
      {...props}
    >
      {loading ? (
        <span
          style={{
            display: 'inline-block',
            width: '14px',
            height: '14px',
            border: '2px solid rgba(255, 255, 255, 0.3)',
            borderTopColor: '#FFFFFF',
            borderRadius: '50%',
            animation: 'kuro-spin 0.6s linear infinite',
          }}
        />
      ) : (
        icon
      )}
      {children}
      <style>{`
        @keyframes kuro-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </button>
  );
};
