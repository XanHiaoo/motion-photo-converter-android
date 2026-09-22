import { describe, expect, it } from 'vitest';
import { fadeCodec } from '../src/lib/video-remux';

function atom(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(payload.length + 8);
  new DataView(bytes.buffer).setUint32(0, bytes.length, false);
  for (let index = 0; index < 4; index += 1) bytes[index + 4] = type.charCodeAt(index);
  bytes.set(payload, 8);
  return bytes;
}

function movie(codec: string): File {
  const ftyp = atom('ftyp', new TextEncoder().encode('isom'));
  const mdat = atom('mdat', new Uint8Array(2 * 1024 * 1024));
  const moov = atom('moov', new TextEncoder().encode(`trak-stsd-${codec}`));
  return new File([ftyp.buffer, mdat.buffer, moov.buffer], 'sample.mp4', { type: 'video/mp4' });
}

describe('fadeCodec', () => {
  it('finds H.264 metadata after a large media-data atom', async () => {
    expect(await fadeCodec(movie('avc1'))).toBe('H.264 / AVC');
  });

  it('finds H.265 metadata after a large media-data atom', async () => {
    expect(await fadeCodec(movie('hvc1'))).toBe('H.265 / HEVC');
  });

  it('rejects an MP4 without supported codec metadata', async () => {
    expect(await fadeCodec(movie('vp09'))).toBeNull();
  });
});
