import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { analyzeBytes, muxSamsungMotionPhoto } from '@/src/core';

const fixtureDir = path.resolve('tests/fixtures');
const samsungPath = path.join(fixtureDir, 'samsung_motion_photo.heic');
const appleImagePath = path.join(fixtureDir, 'apple_live_photo.jpg');
const appleVideoPath = path.join(fixtureDir, 'apple_live_photo.mov');
const hasFixtures = [samsungPath, appleImagePath, appleVideoPath].every(existsSync);

describe.skipIf(!hasFixtures)('downloaded public fixtures', () => {
  it('parses a real Samsung Galaxy S22 Ultra Motion Photo', () => {
    const bytes = new Uint8Array(readFileSync(samsungPath));
    const analysis = analyzeBytes(bytes, 'samsung_motion_photo.heic', 'image/heic');
    expect(analysis.format).toBe('Samsung Motion Photo');
    expect(analysis.hasSamsungTrailer).toBe(true);
    expect(analysis.videoSize).toBeGreaterThan(100_000);
    expect(analysis.mp4Atoms.some((atom) => atom.type === 'ftyp')).toBe(true);
  });

  it('reads the QuickTime content identifier from the public Apple Live Photo video fixture', () => {
    const image = analyzeBytes(new Uint8Array(readFileSync(appleImagePath)), 'apple_live_photo.jpg', 'image/jpeg');
    const video = analyzeBytes(new Uint8Array(readFileSync(appleVideoPath)), 'apple_live_photo.mov', 'video/quicktime');
    expect(image.staticFormat).toBe('JPEG');
    expect(video.contentIdentifier).toBe('7a7d4193-1d91-4907-98f8-3b7e41d991d7');
    expect(video.videoFormat).toBe('MOV/QuickTime');
  });

  it('muxes the public Apple JPEG and MOV into a structurally valid Samsung Motion Photo', () => {
    const image = new Uint8Array(readFileSync(appleImagePath));
    const video = new Uint8Array(readFileSync(appleVideoPath));
    const output = muxSamsungMotionPhoto(image, video, {
      sourceVideoMime: 'video/quicktime',
      timestampUs: -1,
    });
    const analysis = analyzeBytes(output, 'apple_live_photo_MP.jpg', 'image/jpeg');
    expect(analysis.format).toBe('Samsung Motion Photo');
    expect(analysis.videoSize).toBe(video.length);
    expect(analysis.validation.isSamsungCompatible).toBe(true);
    expect(analysis.xmp).toContain(`Item:Length="${video.length + 75}"`);
  });
});
