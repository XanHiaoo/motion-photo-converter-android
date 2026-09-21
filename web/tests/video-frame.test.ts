import { describe, expect, it } from 'vitest';

import { clampFrameTime, formatFrameTime } from '@/src/lib/video-frame';

describe('video cover frame helpers', () => {
  it('defaults to the first frame and stays within the video', () => {
    expect(clampFrameTime(0, 12)).toBe(0);
    expect(clampFrameTime(-2, 12)).toBe(0);
    expect(clampFrameTime(30, 12)).toBeCloseTo(11.95);
  });

  it('formats selected video time', () => {
    expect(formatFrameTime(0)).toBe('00:00');
    expect(formatFrameTime(75.9)).toBe('01:15');
  });
});
