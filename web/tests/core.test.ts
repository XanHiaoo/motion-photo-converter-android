import { describe, expect, it } from 'vitest';

import {
  analyzeBytes,
  buildSamsungTrailer,
  concatBytes,
  locateEmbeddedMotionParts,
  muxSamsungMotionPhoto,
  parseSamsungTrailer,
} from '@/src/core';

function tinyJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46,
    0xff, 0xda, 0x00, 0x02,
    0xff, 0xd9,
  ]);
}

function tinyMp4(): Uint8Array {
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32,
  ]);
}

describe('Samsung SEF trailer', () => {
  it('round-trips the MotionPhoto_Data field offsets', () => {
    const video = tinyMp4();
    const trailer = buildSamsungTrailer(video);
    const parsed = parseSamsungTrailer(trailer.bytes);
    expect(parsed).not.toBeNull();
    expect(parsed?.videoSize).toBe(video.length);
    expect(parsed?.videoStart).toBe(24);
    expect(trailer.primaryPadding).toBe(24);
    expect(trailer.negativeVideoOffset).toBe(video.length + 75);
  });
});

describe('Motion Photo muxer', () => {
  it('creates XMP plus a valid Samsung trailer without changing the source inputs', () => {
    const image = tinyJpeg();
    const video = tinyMp4();
    const output = muxSamsungMotionPhoto(image, video, { timestampUs: 1_500_000 });
    const analysis = analyzeBytes(output, 'MV_TEST_MP.jpg', 'image/jpeg');
    expect(analysis.format).toBe('Samsung Motion Photo');
    expect(analysis.videoSize).toBe(video.length);
    expect(analysis.presentationTimestampUs).toBe(1_500_000);
    expect(analysis.validation.isSamsungCompatible).toBe(true);
    expect(analysis.xmp).toContain(`Item:Length="${video.length + 75}"`);
    expect(analysis.xmp).toContain('Item:Padding="24"');
    expect(image).toEqual(tinyJpeg());
    expect(video).toEqual(tinyMp4());
  });

  it('detects and locates a JPEG with an appended MP4 even without source XMP', () => {
    const image = tinyJpeg();
    const video = tinyMp4();
    const source = concatBytes(image, video);
    const analysis = analyzeBytes(source, 'DJI_DYNAMIC.jpg', 'image/jpeg');
    const ranges = locateEmbeddedMotionParts(analysis);
    expect(analysis.format).toBe('内嵌动态照片');
    expect(ranges.imageEnd).toBe(image.length);
    expect(ranges.videoStart).toBe(image.length);
    expect(ranges.videoEnd).toBe(source.length);
    expect(ranges.videoMime).toBe('video/mp4');
  });
});
