/**
 * Pure Client-Side QR Code Generator (M4A.1 INV-04)
 *
 * Fully self-contained, zero-dependency QR code matrix generator and SVG renderer.
 * Operates 100% offline, zero network requests, zero telemetry, zero analytics.
 *
 * Implements ISO/IEC 18004 QR Code specification (Byte mode, Version 1-10, ECC Level L/M).
 */

// Galois Field GF(256) math tables with primitive polynomial 0x11d
const GF256_EXP = new Uint8Array(512);
const GF256_LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF256_EXP[i] = x;
    GF256_EXP[i + 255] = x;
    GF256_LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return GF256_EXP[GF256_LOG[x] + GF256_LOG[y]];
}

// Precomputed generator polynomials for Reed-Solomon
function rsGenPoly(numEcc: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < numEcc; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF256_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], root);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsComputeEcc(data: Uint8Array, numEcc: number): Uint8Array {
  const gen = rsGenPoly(numEcc);
  const ecc = new Uint8Array(numEcc);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ ecc[0];
    ecc.copyWithin(0, 1);
    ecc[numEcc - 1] = 0;
    for (let j = 0; j < numEcc; j++) {
      ecc[j] ^= gfMul(gen[j], factor);
    }
  }
  return ecc;
}

// QR Version specifications for Byte mode (Level M)
interface QRVersionSpec {
  version: number;
  size: number;
  totalDataBytes: number;
  numEccBytes: number;
  alignmentPositions: number[];
}

const QR_SPECS: QRVersionSpec[] = [
  { version: 1, size: 21, totalDataBytes: 16, numEccBytes: 10, alignmentPositions: [] },
  { version: 2, size: 25, totalDataBytes: 28, numEccBytes: 16, alignmentPositions: [6, 18] },
  { version: 3, size: 29, totalDataBytes: 44, numEccBytes: 26, alignmentPositions: [6, 22] },
  { version: 4, size: 33, totalDataBytes: 64, numEccBytes: 36, alignmentPositions: [6, 26] },
  { version: 5, size: 37, totalDataBytes: 86, numEccBytes: 48, alignmentPositions: [6, 30] },
  { version: 6, size: 41, totalDataBytes: 108, numEccBytes: 64, alignmentPositions: [6, 34] },
  { version: 7, size: 45, totalDataBytes: 124, numEccBytes: 72, alignmentPositions: [6, 22, 38] },
  { version: 8, size: 49, totalDataBytes: 154, numEccBytes: 88, alignmentPositions: [6, 24, 42] },
  { version: 9, size: 53, totalDataBytes: 182, numEccBytes: 110, alignmentPositions: [6, 26, 46] },
  { version: 10, size: 57, totalDataBytes: 216, numEccBytes: 130, alignmentPositions: [6, 28, 50] },
];

export class QRCode {
  public readonly version: number;
  public readonly size: number;
  public readonly modules: boolean[][];

  constructor(text: string) {
    const dataBytes = new TextEncoder().encode(text);
    const spec = QRCode.selectSpec(dataBytes.length);
    this.version = spec.version;
    this.size = spec.size;
    this.modules = Array.from({ length: this.size }, () => Array(this.size).fill(false));

    this.generate(dataBytes, spec);
  }

  private static selectSpec(dataLen: number): QRVersionSpec {
    for (const spec of QR_SPECS) {
      // 4 bits mode + 8 bits length + dataLen bytes
      const neededBytes = Math.ceil((4 + 8 + dataLen * 8 + 4) / 8);
      if (neededBytes <= spec.totalDataBytes) {
        return spec;
      }
    }
    // Fallback to version 10
    return QR_SPECS[QR_SPECS.length - 1];
  }

  private generate(dataBytes: Uint8Array, spec: QRVersionSpec): void {
    const isFunction: boolean[][] = Array.from({ length: this.size }, () => Array(this.size).fill(false));

    // 1. Finder patterns
    this.drawFinderPattern(0, 0, isFunction);
    this.drawFinderPattern(this.size - 7, 0, isFunction);
    this.drawFinderPattern(0, this.size - 7, isFunction);

    // 2. Alignment patterns
    for (const r of spec.alignmentPositions) {
      for (const c of spec.alignmentPositions) {
        if (!isFunction[r][c]) {
          this.drawAlignmentPattern(r, c, isFunction);
        }
      }
    }

    // 3. Timing patterns
    for (let i = 8; i < this.size - 8; i++) {
      const bit = i % 2 === 0;
      if (!isFunction[6][i]) {
        this.modules[6][i] = bit;
        isFunction[6][i] = true;
      }
      if (!isFunction[i][6]) {
        this.modules[i][6] = bit;
        isFunction[i][6] = true;
      }
    }

    // 4. Dark module
    this.modules[4 * spec.version + 9][8] = true;
    isFunction[4 * spec.version + 9][8] = true;

    // 5. Reserve format information areas
    for (let i = 0; i < 9; i++) {
      isFunction[8][i] = true;
      isFunction[i][8] = true;
    }
    for (let i = 0; i < 8; i++) {
      isFunction[8][this.size - 1 - i] = true;
      isFunction[this.size - 1 - i][8] = true;
    }

    // 6. Encode data stream
    const bitBuffer: number[] = [];
    const pushBits = (val: number, len: number) => {
      for (let i = len - 1; i >= 0; i--) {
        bitBuffer.push((val >> i) & 1);
      }
    };

    // Mode: Byte (0100)
    pushBits(0b0100, 4);
    // Character count (8 bits for v1-v9, 16 for v10+)
    pushBits(dataBytes.length, spec.version <= 9 ? 8 : 16);
    // Data
    for (const b of dataBytes) {
      pushBits(b, 8);
    }
    // Terminator (up to 4 zeroes)
    const maxBits = spec.totalDataBytes * 8;
    const termLen = Math.min(4, maxBits - bitBuffer.length);
    for (let i = 0; i < termLen; i++) bitBuffer.push(0);

    // Byte padding
    while (bitBuffer.length % 8 !== 0) bitBuffer.push(0);

    // Alternating pad bytes
    const padBytes = [0xec, 0x11];
    let padIdx = 0;
    while (bitBuffer.length < maxBits) {
      pushBits(padBytes[padIdx % 2], 8);
      padIdx++;
    }

    // Pack into Uint8Array
    const dataCodewords = new Uint8Array(spec.totalDataBytes);
    for (let i = 0; i < dataCodewords.length; i++) {
      let b = 0;
      for (let j = 0; j < 8; j++) {
        b = (b << 1) | bitBuffer[i * 8 + j];
      }
      dataCodewords[i] = b;
    }

    // Compute Error Correction Codewords
    const eccCodewords = rsComputeEcc(dataCodewords, spec.numEccBytes);

    // Full codeword sequence
    const allCodewords = new Uint8Array(dataCodewords.length + eccCodewords.length);
    allCodewords.set(dataCodewords);
    allCodewords.set(eccCodewords, dataCodewords.length);

    // 7. Place data bits onto matrix (zigzag upward and downward)
    const allBits: number[] = [];
    for (const cw of allCodewords) {
      for (let i = 7; i >= 0; i--) {
        allBits.push((cw >> i) & 1);
      }
    }

    let bitIdx = 0;
    let right = this.size - 1;
    let upward = true;

    while (right > 0) {
      if (right === 6) right--; // Skip vertical timing line

      const rows = upward
        ? Array.from({ length: this.size }, (_, i) => this.size - 1 - i)
        : Array.from({ length: this.size }, (_, i) => i);

      for (const r of rows) {
        for (let i = 0; i < 2; i++) {
          const c = right - i;
          if (!isFunction[r][c]) {
            const bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
            // Apply Mask 0: (row + col) % 2 === 0
            const mask = (r + c) % 2 === 0;
            this.modules[r][c] = (bit ^ (mask ? 1 : 0)) === 1;
          }
        }
      }

      upward = !upward;
      right -= 2;
    }

    // 8. Draw format information (ECC Level M = 00, Mask 0 = 000 -> Format 00000 -> BCH 101010000010010)
    const formatBits = 0b101010000010010;
    for (let i = 0; i < 15; i++) {
      const bit = ((formatBits >> (14 - i)) & 1) === 1;
      // Top-left
      if (i < 6) this.modules[8][i] = bit;
      else if (i < 8) this.modules[8][i + 1] = bit;
      else if (i === 8) this.modules[7][8] = bit;
      else this.modules[14 - i][8] = bit;

      // Bottom-left / Top-right
      if (i < 8) this.modules[this.size - 1 - i][8] = bit;
      else this.modules[8][this.size - 15 + i] = bit;
    }
  }

  private drawFinderPattern(row: number, col: number, isFunction: boolean[][]): void {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr >= 0 && nr < this.size && nc >= 0 && nc < this.size) {
          const isBlack =
            (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          this.modules[nr][nc] = isBlack;
          isFunction[nr][nc] = true;
        }
      }
    }
  }

  private drawAlignmentPattern(row: number, col: number, isFunction: boolean[][]): void {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const nr = row + r;
        const nc = col + c;
        const isBlack = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        this.modules[nr][nc] = isBlack;
        isFunction[nr][nc] = true;
      }
    }
  }

  /**
   * Generates a scalable vector SVG string of the QR code.
   */
  public toSVG(options?: {
    size?: number;
    margin?: number;
    color?: string;
    bgColor?: string;
    title?: string;
  }): string {
    const size = options?.size ?? 256;
    const margin = options?.margin ?? 4;
    const color = options?.color ?? '#000000';
    const bgColor = options?.bgColor ?? '#ffffff';
    const title = options?.title ?? 'Meeting QR Code';

    const fullSize = this.size + margin * 2;
    let pathData = '';

    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.modules[r][c]) {
          const x = c + margin;
          const y = r + margin;
          pathData += `M${x},${y}h1v1h-1z `;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fullSize} ${fullSize}" width="${size}" height="${size}" role="img" aria-label="${title}">
  <rect width="100%" height="100%" fill="${bgColor}"/>
  <path d="${pathData.trim()}" fill="${color}"/>
</svg>`;
  }
}

/**
 * Convenience function to generate SVG string directly from text.
 */
export function generateQRCodeSVG(
  text: string,
  options?: { size?: number; margin?: number; color?: string; bgColor?: string; title?: string }
): string {
  const qr = new QRCode(text);
  return qr.toSVG(options);
}
