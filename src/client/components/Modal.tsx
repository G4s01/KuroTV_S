import React, { useEffect } from 'react';
import { oledTheme, FONT_MONO } from '../theme';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = '500px',
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: oledTheme.colors.overlay,
        backdropFilter: 'blur(4px)',
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth,
          backgroundColor: '#0A0A0A',
          border: `1px solid ${oledTheme.colors.border}`,
          borderRadius: oledTheme.radius.lg,
          padding: '24px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.9), 0 10px 10px -5px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${oledTheme.colors.border}`,
            paddingBottom: '14px',
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '18px',
              fontFamily: FONT_MONO,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: oledTheme.colors.text,
            }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: oledTheme.colors.textMuted,
              fontSize: '22px',
              lineHeight: 1,
              cursor: 'pointer',
              padding: '4px',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#FFFFFF')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = oledTheme.colors.textMuted)}
          >
            &times;
          </button>
        </div>

        <div>{children}</div>
      </div>
    </div>
  );
};
