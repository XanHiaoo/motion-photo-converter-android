const encoder = new TextEncoder();

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

export function ascii(bytes: Uint8Array, start: number, length: number): string {
  let result = '';
  const end = Math.min(bytes.length, start + length);
  for (let index = start; index < end; index += 1) result += String.fromCharCode(bytes[index]);
  return result;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function readBe16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

export function readBe32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

export function readLe32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

export function writeBe16(value: number): Uint8Array {
  const output = new Uint8Array(2);
  new DataView(output.buffer).setUint16(0, value, false);
  return output;
}

export function writeLe32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, true);
  return output;
}

export function findAscii(bytes: Uint8Array, needle: string, from = 0, limit = bytes.length): number {
  const target = utf8(needle);
  const end = Math.min(limit, bytes.length) - target.length;
  outer: for (let index = Math.max(0, from); index <= end; index += 1) {
    for (let inner = 0; inner < target.length; inner += 1) {
      if (bytes[index + inner] !== target[inner]) continue outer;
    }
    return index;
  }
  return -1;
}

export function formatBytes(value: number | null): string {
  if (value === null) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(2)} MB`;
}

export function normalizedStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/(?:_MP|\.LIVE)$/i, '').toLowerCase();
}
