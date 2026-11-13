import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { FONT_MONO, oledTheme } from '../theme';

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  submessage?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'CONFERMA OPERAZIONE',
  message,
  submessage,
  confirmLabel = 'CONFERMA',
  cancelLabel = 'ANNULLA',
  variant = 'danger',
  loading = false,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="420px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <p
          style={{
            fontFamily: FONT_MONO,
            fontSize: '13px',
            color: '#FFFFFF',
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>

        {submessage && (
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '11px',
              color: oledTheme.colors.textMuted,
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            {submessage}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            size="sm"
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
