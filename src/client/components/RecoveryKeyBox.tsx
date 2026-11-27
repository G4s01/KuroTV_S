import React, { useState } from 'react';
import { oledTheme, FONT_MONO } from '../theme';
import { Button } from './Button';
import { CheckIcon, CopyIcon, DownloadIcon, KeyIcon } from './Icons';
import { copyTextSafe } from '../malOAuth';

interface RecoveryKeyBoxProps {
  recoveryKey: string;
  title?: string;
  subtitle?: string;
}

export function downloadRecoveryKeyTxt(recoveryKey: string): void {
  if (typeof document === 'undefined' || !recoveryKey) return;
  const content = [
    'KUROSYNC — RECOVERY KEY DI EMERGENZA',
    `GENERATA IL: ${new Date().toISOString()}`,
    '',
    `RECOVERY KEY: ${recoveryKey}`,
    '',
    'CONSERVA QUESTO FILE IN UN LUOGO SICURO.',
    'SERVE PER RESETTARE LA MASTER PASSWORD SE DIMENTICATA.',
  ].join('\n');

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kurosync-recovery-key-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const RecoveryKeyBox: React.FC<RecoveryKeyBoxProps> = ({
  recoveryKey,
  title = 'RECOVERY KEY DI EMERGENZA',
  subtitle = 'SALVALA ORA IN UN LUOGO SICURO: NON VERRÀ PIÙ MOSTRATA DOPO LA CHIUSURA.',
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyTextSafe(recoveryKey);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      style={{
        backgroundColor: '#070707',
        border: '1px solid #10B981',
        borderRadius: oledTheme.radius.sm,
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontFamily: FONT_MONO,
          fontSize: '12px',
          fontWeight: 700,
          color: '#10B981',
        }}
      >
        <KeyIcon size={15} color="#F59E0B" aria-hidden="true" />
        <span>{title}</span>
      </div>

      <p
        style={{
          fontFamily: FONT_MONO,
          fontSize: '11px',
          color: oledTheme.colors.textSecondary,
          margin: 0,
          lineHeight: 1.45,
        }}
      >
        {subtitle}
      </p>

      <input
        type="text"
        readOnly
        value={recoveryKey}
        aria-label="RECOVERY KEY"
        className="raw-token"
        onFocus={(e) => e.currentTarget.select()}
        style={{
          width: '100%',
          padding: '10px 12px',
          backgroundColor: '#000000',
          border: `1px solid ${oledTheme.colors.border}`,
          borderRadius: oledTheme.radius.sm,
          color: '#FFFFFF',
          fontFamily: FONT_MONO,
          fontSize: '13px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textAlign: 'center',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleCopy}
          style={{ flex: 1 }}
          icon={
            copied ? (
              <CheckIcon size={13} color="#10B981" aria-hidden="true" />
            ) : (
              <CopyIcon size={13} color="#3B82F6" aria-hidden="true" />
            )
          }
        >
          {copied ? 'COPIATO' : 'COPIA KEY'}
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => downloadRecoveryKeyTxt(recoveryKey)}
          style={{ flex: 1 }}
          icon={<DownloadIcon size={13} color="#10B981" aria-hidden="true" />}
        >
          SCARICA .TXT
        </Button>
      </div>
    </div>
  );
};
