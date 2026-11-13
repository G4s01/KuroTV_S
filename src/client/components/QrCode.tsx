import React, { useMemo } from 'react';
import QRCode from 'qrcode';

interface QrCodeProps {
  value: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
  margin?: number;
  style?: React.CSSProperties;
}

/**
 * High-performance, standards-compliant QR Code generator
 * Powered by battle-tested 'qrcode' library (ISO/IEC 18004 compliant).
 * Renders high-contrast dark modules on pure white background
 * ensuring 100% instant readability by any smartphone camera or scanner.
 */
export const QrCode: React.FC<QrCodeProps> = ({
  value,
  size = 200,
  fgColor = '#000000',
  bgColor = '#FFFFFF',
  margin = 3,
  style,
}) => {
  const qr = useMemo(() => {
    try {
      return QRCode.create(value || 'kurosync', {
        errorCorrectionLevel: 'M',
      });
    } catch (e) {
      console.warn('QR Code generation fallback:', e);
      return QRCode.create('error', { errorCorrectionLevel: 'L' });
    }
  }, [value]);

  const moduleCount = qr.modules.size;
  const totalSize = moduleCount + margin * 2;
  const cellSize = 10;
  const viewBoxSize = totalSize * cellSize;

  return (
    <div
      style={{
        display: 'inline-block',
        backgroundColor: bgColor,
        padding: '12px',
        borderRadius: '12px',
        border: '1px solid #262626',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
        ...style,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        shapeRendering="crispEdges"
        style={{ display: 'block', borderRadius: '4px' }}
      >
        <rect width="100%" height="100%" fill={bgColor} />
        {Array.from({ length: moduleCount }).map((_, r) =>
          Array.from({ length: moduleCount }).map((__, c) => {
            if (!qr.modules.get(r, c)) return null;
            return (
              <rect
                key={`${r}-${c}`}
                x={(c + margin) * cellSize}
                y={(r + margin) * cellSize}
                width={cellSize}
                height={cellSize}
                fill={fgColor}
              />
            );
          })
        )}
      </svg>
    </div>
  );
};
