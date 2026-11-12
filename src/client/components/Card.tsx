import React from 'react';
import { oledTheme } from '../theme';

interface CardProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  style,
  onClick,
  hoverable = false,
}) => {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => hoverable && setIsHovered(true)}
      onMouseLeave={() => hoverable && setIsHovered(false)}
      style={{
        backgroundColor: oledTheme.colors.card,
        border: `1px solid ${isHovered ? oledTheme.colors.borderActive : oledTheme.colors.border}`,
        borderRadius: oledTheme.radius.md,
        padding: '20px',
        transition: 'border-color 0.2s ease, transform 0.2s ease',
        cursor: onClick ? 'pointer' : 'default',
        transform: isHovered ? 'translateY(-2px)' : 'none',
        ...style,
      }}
    >
      {children}
    </div>
  );
};
