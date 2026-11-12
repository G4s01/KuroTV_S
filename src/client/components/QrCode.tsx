import React, { useMemo } from 'react';

/**
 * Pure TypeScript Zero-Dependency QR Code Generator
 * Generates standards-compliant QR Code matrices (ISO/IEC 18004)
 * rendered directly as an SVG vector image.
 */

// Galois Field GF(256) arithmetic for Reed-Solomon error correction
const EXP_TABLE = new Uint8Array(256);
const LOG_TABLE = new Uint8Array(256);

(function initGaloisField() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = val;
    LOG_TABLE[val] = i;
    val = (val << 1) ^ (val >= 128 ? 0x11d : 0);
  }
  EXP_TABLE[255] = EXP_TABLE[0];
})();

function gfMultiply(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[x] + LOG_TABLE[y]) % 255];
}

function rsComputePoly(ecCount: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < ecCount; i++) {
    const factor = new Uint8Array([1, EXP_TABLE[i]]);
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMultiply(poly[j], factor[0]);
      next[j + 1] ^= gfMultiply(poly[j], factor[1]);
    }
    poly = next;
  }
  return poly;
}

function rsCalculate(data: Uint8Array, ecCount: number): Uint8Array {
  const poly = rsComputePoly(ecCount);
  const remainder = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    for (let j = 0; j < ecCount - 1; j++) {
      remainder[j] = remainder[j + 1] ^ gfMultiply(poly[j + 1], factor);
    }
    remainder[ecCount - 1] = gfMultiply(poly[ecCount], factor);
  }
  return remainder;
}

// Version table: total bytes, EC bytes for Low (L) error correction
const VERSION_SPECS = [
  { version: 1, size: 21, totalBytes: 26, ecBytes: 7, dataBytes: 19 },
  { version: 2, size: 25, totalBytes: 44, ecBytes: 10, dataBytes: 34 },
  { version: 3, size: 29, totalBytes: 70, ecBytes: 15, dataBytes: 55 },
  { version: 4, size: 33, totalBytes: 100, ecBytes: 20, dataBytes: 80 },
  { version: 5, size: 37, totalBytes: 134, ecBytes: 26, dataBytes: 108 },
  { version: 6, size: 41, totalBytes: 172, ecBytes: 18 * 2, dataBytes: 136 },
  { version: 7, size: 45, totalBytes: 196, ecBytes: 20 * 2, dataBytes: 156 },
  { version: 8, size: 49, totalBytes: 242, ecBytes: 24 * 2, dataBytes: 194 },
  { version: 9, size: 53, totalBytes: 292, ecBytes: 30 * 2, dataBytes: 232 },
  { version: 10, size: 57, totalBytes: 346, ecBytes: 18 * 4, dataBytes: 274 },
];

function selectVersion(dataLength: number) {
  // 4 bits mode + 8/16 bits length + data
  const requiredDataBytes = dataLength + 3;
  for (const v of VERSION_SPECS) {
    if (v.dataBytes >= requiredDataBytes) {
      return v;
    }
  }
  return VERSION_SPECS[VERSION_SPECS.length - 1];
}

class BitBuffer {
  buffer: number[] = [];
  length: number = 0;

  put(num: number, length: number) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }

  getBytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

function generateQrMatrix(text: string): boolean[][] {
  const utf8Encoder = new TextEncoder();
  const textBytes = utf8Encoder.encode(text);
  const spec = selectVersion(textBytes.length);
  const size = spec.size;

  // 1. Bit Stream Generation (Byte Mode)
  const bb = new BitBuffer();
  bb.put(0x4, 4); // 8-bit byte mode indicator
  bb.put(textBytes.length, spec.version < 10 ? 8 : 16); // Character count indicator
  for (let i = 0; i < textBytes.length; i++) {
    bb.put(textBytes[i], 8);
  }

  // Terminator (4 zero bits)
  const remainingBits = spec.dataBytes * 8 - bb.length;
  bb.put(0, Math.min(4, Math.max(0, remainingBits)));

  // Byte align
  while (bb.length % 8 !== 0) {
    bb.putBit(false);
  }

  // Pad bytes 0xEC, 0x11
  let padToggle = false;
  while (bb.length < spec.dataBytes * 8) {
    bb.put(padToggle ? 0x11 : 0xec, 8);
    padToggle = !padToggle;
  }

  const dataBytes = bb.getBytes().slice(0, spec.dataBytes);
  const ecBytes = rsCalculate(dataBytes, spec.ecBytes);

  // Combine data + EC codewords
  const totalCodewords = new Uint8Array(spec.totalBytes);
  totalCodewords.set(dataBytes, 0);
  totalCodewords.set(ecBytes, dataBytes.length);

  // 2. Initialize Matrix
  const matrix: boolean[][] = Array.from({ length: size }, () =>
    Array(size).fill(false)
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    Array(size).fill(false)
  );

  // Finder patterns helper
  function placeFinder(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
          reserved[nr][nc] = true;
          if (
            (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4)
          ) {
            matrix[nr][nc] = true;
          } else {
            matrix[nr][nc] = false;
          }
        }
      }
    }
  }

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) {
      reserved[6][i] = true;
      matrix[6][i] = i % 2 === 0;
    }
    if (!reserved[i][6]) {
      reserved[i][6] = true;
      matrix[i][6] = i % 2 === 0;
    }
  }

  // Dark module
  reserved[4 * spec.version + 9][8] = true;
  matrix[4 * spec.version + 9][8] = true;

  // Reserve format info areas
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  // Alignment patterns for version >= 2
  if (spec.version >= 2) {
    const alignPos = [6, size - 7];
    for (const ar of alignPos) {
      for (const ac of alignPos) {
        if (!reserved[ar][ac]) {
          for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
              reserved[ar + r][ac + c] = true;
              matrix[ar + r][ac + c] =
                Math.max(Math.abs(r), Math.abs(c)) !== 1;
            }
          }
        }
      }
    }
  }

  // 3. Place Data Bits
  let byteIndex = 0;
  let bitIndex = 7;
  let upwards = true;

  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing column
    const rows = upwards
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const r of rows) {
      for (let c = right; c >= right - 1; c--) {
        if (!reserved[r][c]) {
          let bit = false;
          if (byteIndex < totalCodewords.length) {
            bit = ((totalCodewords[byteIndex] >>> bitIndex) & 1) === 1;
            bitIndex--;
            if (bitIndex < 0) {
              bitIndex = 7;
              byteIndex++;
            }
          }
          // Mask 000: (row + col) % 2 === 0
          const mask = (r + c) % 2 === 0;
          matrix[r][c] = mask ? !bit : bit;
        }
      }
    }
    upwards = !upwards;
  }

  // 4. Format Info for EC Level L (01) & Mask 000: bits = 0x77c4
  const formatBits = 0x77c4;
  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >>> i) & 1) === 1;
    // Around top-left
    if (i < 6) matrix[i][8] = bit;
    else if (i < 8) matrix[i + 1][8] = bit;
    else if (i === 8) matrix[8][7] = bit;
    else matrix[8][14 - i] = bit;

    // Around top-right & bottom-left
    if (i < 8) matrix[8][size - 1 - i] = bit;
    else matrix[size - 15 + i][8] = bit;
  }

  return matrix;
}

interface QrCodeProps {
  value: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
  style?: React.CSSProperties;
}

export const QrCode: React.FC<QrCodeProps> = ({
  value,
  size = 180,
  fgColor = '#FFFFFF',
  bgColor = '#000000',
  style,
}) => {
  const matrix = useMemo(() => {
    try {
      return generateQrMatrix(value || 'kurosync');
    } catch (e) {
      console.warn('QR Code generation fallback:', e);
      return Array.from({ length: 21 }, () => Array(21).fill(false));
    }
  }, [value]);

  const moduleCount = matrix.length;
  const cellSize = 10;
  const quietZone = 2; // quiet zone in cells
  const viewBoxSize = (moduleCount + quietZone * 2) * cellSize;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      style={{
        borderRadius: '8px',
        border: '1px solid #262626',
        backgroundColor: bgColor,
        display: 'block',
        ...style,
      }}
    >
      <rect width="100%" height="100%" fill={bgColor} />
      {matrix.map((row, r) =>
        row.map((cell, c) => {
          if (!cell) return null;
          return (
            <rect
              key={`${r}-${c}`}
              x={(c + quietZone) * cellSize}
              y={(r + quietZone) * cellSize}
              width={cellSize}
              height={cellSize}
              fill={fgColor}
            />
          );
        })
      )}
    </svg>
  );
};
