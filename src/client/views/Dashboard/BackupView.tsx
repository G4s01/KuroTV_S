import React, { useState } from 'react';
import { oledTheme, FONT_MONO } from '../../theme';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { DownloadIcon, UploadIcon, CheckIcon } from '../../components/Icons';
import { api } from '../../api';

interface BackupViewProps {
  onRestoreSuccess?: () => void;
}

export const BackupView: React.FC<BackupViewProps> = ({ onRestoreSuccess }) => {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPayload, setImportPayload] = useState<any | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const data = await api.exportBackup();
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kurosync-backup-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccessMsg('Backup export generated and downloaded successfully.');
    } catch (err: any) {
      setError(err?.message || 'Failed to export backup.');
    } finally {
      setExporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setSuccessMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        setImportPayload(parsed);
      } catch {
        setError('Selected file is not valid JSON.');
        setImportPayload(null);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importPayload) return;
    const confirmed = window.confirm(
      'Are you sure you want to restore this backup? Existing records will be updated and missing profiles created.'
    );
    if (!confirmed) return;

    setImporting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await api.importBackup(importPayload);
      setSuccessMsg(res.message || 'Backup successfully restored to instance.');
      setImportPayload(null);
      setFileName(null);
      if (onRestoreSuccess) onRestoreSuccess();
    } catch (err: any) {
      setError(err?.message || 'Failed to restore backup.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div
        style={{
          borderBottom: `1px solid ${oledTheme.colors.border}`,
          paddingBottom: '16px',
        }}
      >
        <h2
          style={{
            fontFamily: FONT_MONO,
            fontSize: '18px',
            fontWeight: 700,
            color: '#FFFFFF',
            margin: '0 0 4px 0',
            textTransform: 'uppercase',
          }}
        >
          Backup &amp; Restore
        </h2>
        <p
          style={{
            fontFamily: FONT_MONO,
            fontSize: '12px',
            color: oledTheme.colors.textSecondary,
            margin: 0,
          }}
        >
          Export full JSON instance snapshots or restore viewing history and profile configuration.
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 14px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #EF4444',
            borderRadius: oledTheme.radius.sm,
            color: '#EF4444',
            fontSize: '13px',
            fontFamily: FONT_MONO,
          }}
        >
          {error}
        </div>
      )}

      {successMsg && (
        <div
          style={{
            padding: '12px 14px',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid #10B981',
            borderRadius: oledTheme.radius.sm,
            color: '#10B981',
            fontSize: '13px',
            fontFamily: FONT_MONO,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CheckIcon size={16} color="#10B981" />
          {successMsg}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '20px',
        }}
      >
        {/* Export Card */}
        <Card style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h3
              style={{
                fontFamily: FONT_MONO,
                fontSize: '15px',
                fontWeight: 700,
                color: '#FFFFFF',
                margin: '0 0 6px 0',
                textTransform: 'uppercase',
              }}
            >
              Export JSON Backup
            </h3>
            <p
              style={{
                fontFamily: FONT_MONO,
                fontSize: '12px',
                color: oledTheme.colors.textSecondary,
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              Downloads an encrypted-ready JSON document containing all instance profiles, continue watching progress, favorites, and settings.
            </p>
          </div>

          <Button
            variant="primary"
            onClick={handleExport}
            loading={exporting}
            icon={<DownloadIcon size={16} />}
          >
            DOWNLOAD BACKUP (.JSON)
          </Button>
        </Card>

        {/* Restore Card */}
        <Card style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h3
              style={{
                fontFamily: FONT_MONO,
                fontSize: '15px',
                fontWeight: 700,
                color: '#FFFFFF',
                margin: '0 0 6px 0',
                textTransform: 'uppercase',
              }}
            >
              Restore from JSON Backup
            </h3>
            <p
              style={{
                fontFamily: FONT_MONO,
                fontSize: '12px',
                color: oledTheme.colors.textSecondary,
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              Select a previously exported KuroSync backup file to restore records atomically into Cloudflare D1.
            </p>
          </div>

          <label
            style={{
              display: 'block',
              border: `2px dashed ${fileName ? oledTheme.colors.primary : oledTheme.colors.border}`,
              borderRadius: oledTheme.radius.md,
              padding: '24px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              backgroundColor: '#050505',
              transition: 'all 0.15s ease',
            }}
          >
            <input
              type="file"
              accept=".json"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <UploadIcon size={24} color={fileName ? '#E50914' : oledTheme.colors.textMuted} />
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: '13px',
                  fontWeight: 600,
                  color: fileName ? '#FFFFFF' : oledTheme.colors.textSecondary,
                }}
              >
                {fileName || 'Click or drop KuroSync JSON backup here'}
              </span>
            </div>
          </label>

          {/* Import Preview */}
          {importPayload && (
            <div
              style={{
                backgroundColor: '#121212',
                border: `1px solid ${oledTheme.colors.border}`,
                borderRadius: oledTheme.radius.sm,
                padding: '12px 14px',
                fontSize: '12px',
                fontFamily: FONT_MONO,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <span style={{ color: oledTheme.colors.textMuted, fontWeight: 700 }}>
                PAYLOAD SUMMARY:
              </span>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: oledTheme.colors.textSecondary }}>Profiles:</span>
                <span style={{ color: '#FFFFFF' }}>{importPayload.profiles?.length || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: oledTheme.colors.textSecondary }}>Continue Watching:</span>
                <span style={{ color: '#FFFFFF' }}>{importPayload.continueWatching?.length || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: oledTheme.colors.textSecondary }}>Favorites:</span>
                <span style={{ color: '#FFFFFF' }}>{importPayload.favorites?.length || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: oledTheme.colors.textSecondary }}>Watch History:</span>
                <span style={{ color: '#FFFFFF' }}>{importPayload.watchHistory?.length || 0}</span>
              </div>
            </div>
          )}

          <Button
            variant="secondary"
            disabled={!importPayload}
            loading={importing}
            onClick={handleImport}
            icon={<UploadIcon size={16} />}
          >
            RESTORE TO INSTANCE
          </Button>
        </Card>
      </div>
    </div>
  );
};
