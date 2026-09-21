import { describe, expect, it } from 'vitest';

import { clampClipEnd, clampClipStart, clampCoverTime, coverOffsetInClip, formatClipTime, isClipTrimmed, positionToClipTime, trimArguments } from '@/src/lib/video-trim';

describe('video clip selection', () => {
  it('keeps the start and end at least 0.2 seconds apart', () => {
    expect(clampClipStart(9.9, 10, 12)).toBeCloseTo(9.8);
    expect(clampClipStart(-2, 10, 12)).toBe(0);
    expect(clampClipEnd(2.1, 2, 12)).toBeCloseTo(2.2);
    expect(clampClipEnd(99, 2, 12)).toBe(12);
  });

  it('keeps the cover inside the selected clip', () => {
    expect(clampCoverTime(0, 2, 5)).toBe(2);
    expect(clampCoverTime(9, 2, 5)).toBeCloseTo(4.95);
    expect(clampCoverTime(3, 2, 5)).toBe(3);
  });

  it('does not re-encode an unchanged clip', () => {
    expect(isClipTrimmed(0, 10, 10)).toBe(false);
    expect(isClipTrimmed(1, 10, 10)).toBe(true);
    expect(isClipTrimmed(0, 9, 10)).toBe(true);
  });

  it('formats subsecond positions', () => {
    expect(formatClipTime(75.29)).toBe('01:15.2');
  });

  it('maps a shared timeline to a clamped video position', () => {
    expect(positionToClipTime(150, 100, 200, 10)).toBe(2.5);
    expect(positionToClipTime(50, 100, 200, 10)).toBe(0);
    expect(positionToClipTime(350, 100, 200, 10)).toBe(10);
    expect(positionToClipTime(150, 100, 0, 10)).toBe(0);
  });

  it('copies streams by default, avoiding an unnecessary re-encode', () => {
    const args = trimArguments('input.mp4', 'clip.mp4', 2.5, 5.75, 'fast');
    expect(args.slice(0, 6)).toEqual(['-ss', '2.500', '-i', 'input.mp4', '-t', '3.250']);
    expect(args).toContain('copy');
    expect(args).not.toContain('libx264');
    expect(trimArguments('input.mp4', 'clip.mp4', 0, 5.75, 'fast').slice(0, 2)).toEqual(['-i', 'input.mp4']);
  });

  it('keeps an exact H.264/AAC option for frame-accurate cuts', () => {
    const args = trimArguments('input.mp4', 'clip.mp4', 2.5, 5.75, 'precise');
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
    expect(args.at(-1)).toBe('clip.mp4');
    expect(() => trimArguments('input.mp4', 'clip.mp4', 2, 2.1, 'precise')).toThrow();
  });

  it('accounts for retained pre-roll in fast cuts when placing the cover timestamp', () => {
    expect(coverOffsetInClip(1.3, 1.3, 3.2, 2.2, 'fast')).toBeCloseTo(0.3);
    expect(coverOffsetInClip(1.3, 1.3, 3.2, 1.9, 'precise')).toBe(0);
  });
});
