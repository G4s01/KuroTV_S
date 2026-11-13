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
  maxWidth = '480px',
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
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        padding: '16px',
        animation: 'kuro-modal-fade 0.2s ease-out',
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
          borderTop: '2px solid #E50914',
          borderRadius: oledTheme.radius.md,
          padding: '20px 22px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.95), 0 0 20px rgba(229, 9, 20, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          maxHeight: '85vh',
          overflowY: 'auto',
          animation: 'kuro-modal-zoom 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${oledTheme.colors.border}`,
            paddingBottom: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                display: 'inline-block',
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#E50914',
                boxShadow: '0 0 8px #E50914',
              }}
            />
            <h2
              style={{
                margin: 0,
                fontSize: '15px',
                fontFamily: FONT_MONO,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: '#FFFFFF',
              }}
            >
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: oledTheme.colors.textMuted,
              fontSize: '20px',
              lineHeight: 1,
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: '4px',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = '#FFFFFF';
              (e.currentTarget as HTMLElement).style.backgroundColor = '#1F1F1F';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = oledTheme.colors.textMuted;
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
          >
            &times;
          </button>
        </div>

        <div>{children}</div>
      </div>
      <style>{`
        @keyframes kuro-modal-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes kuro-modal-zoom {
          from { opacity: 0; transform: scale(0.96) translateY(-6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
};
