package com.xanhiaoo.motionphotoconverter;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.media.Image;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.media.MediaMuxer;

import java.io.File;
import java.nio.ByteBuffer;

final class FadeTailEncoder {
    private static final int FPS = 30;

    static String hardwareEncoder(String mime, int width, int height) {
        if (width < 2 || height < 2 || (width & 1) != 0 || (height & 1) != 0) return null;
        for (MediaCodecInfo info : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
            if (!info.isEncoder() || !info.isHardwareAccelerated() || info.isAlias()) continue;
            try {
                MediaCodecInfo.CodecCapabilities caps = info.getCapabilitiesForType(mime);
                boolean flexible = false;
                for (int color : caps.colorFormats) {
                    if (color == MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible) flexible = true;
                }
                if (flexible && caps.getVideoCapabilities().areSizeAndRateSupported(width, height, FPS)) return info.getName();
            } catch (IllegalArgumentException ignored) {
                // This codec does not encode the requested format.
            }
        }
        return null;
    }

    static void encode(byte[] lastJpeg, byte[] coverJpeg, int width, int height,
                       int durationMs, String mime, String encoderName, File output) throws Exception {
        Bitmap last = scaledBitmap(lastJpeg, width, height);
        Bitmap cover = scaledBitmap(coverJpeg, width, height);
        MediaCodec codec = null;
        MediaMuxer muxer = null;
        boolean muxerStarted = false;
        boolean codecStarted = false;
        try {
            int[] lastRows = new int[width * 2];
            int[] coverRows = new int[width * 2];

            MediaFormat format = MediaFormat.createVideoFormat(mime, width, height);
            format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
            format.setInteger(MediaFormat.KEY_BIT_RATE,
                    (int) Math.max(2_000_000, Math.min(50_000_000, width * (long) height * FPS / 10L)));
            format.setInteger(MediaFormat.KEY_FRAME_RATE, FPS);
            format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
            format.setInteger(MediaFormat.KEY_COLOR_STANDARD, height >= 720
                    ? MediaFormat.COLOR_STANDARD_BT709 : MediaFormat.COLOR_STANDARD_BT601_PAL);
            format.setInteger(MediaFormat.KEY_COLOR_RANGE, MediaFormat.COLOR_RANGE_LIMITED);
            codec = MediaCodec.createByCodecName(encoderName);
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            codec.start();
            codecStarted = true;
            muxer = new MediaMuxer(output.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int frames = Math.max(2, (int) Math.ceil(durationMs * FPS / 1000.0));
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            int track = -1;
            for (int frame = 0; frame < frames; frame++) {
                long inputDeadline = System.currentTimeMillis() + 20_000;
                int inputIndex = codec.dequeueInputBuffer(1_000_000);
                while (inputIndex < 0) {
                    if (System.currentTimeMillis() >= inputDeadline) throw new IllegalStateException("硬件编码输入超时");
                    int drained = drain(codec, muxer, info, track, false);
                    if (drained >= 0) { track = drained; muxerStarted = true; }
                    inputIndex = codec.dequeueInputBuffer(1_000_000);
                }
                Image image = codec.getInputImage(inputIndex);
                if (image == null) throw new IllegalStateException("硬件编码器未提供 YUV 输入画面");
                try {
                    writeFrame(image, last, cover, lastRows, coverRows, width, height,
                            (double) frame / (frames - 1));
                } finally {
                    image.close();
                }
                long pts = Math.round(frame * 1_000_000.0 / FPS);
                codec.queueInputBuffer(inputIndex, 0, width * height * 3 / 2, pts, 0);
                int drained = drain(codec, muxer, info, track, false);
                if (drained >= 0) { track = drained; muxerStarted = true; }
            }
            long inputDeadline = System.currentTimeMillis() + 20_000;
            int eosIndex = codec.dequeueInputBuffer(1_000_000);
            while (eosIndex < 0) {
                if (System.currentTimeMillis() >= inputDeadline) throw new IllegalStateException("硬件编码结束超时");
                int drained = drain(codec, muxer, info, track, false);
                if (drained >= 0) { track = drained; muxerStarted = true; }
                eosIndex = codec.dequeueInputBuffer(1_000_000);
            }
            codec.queueInputBuffer(eosIndex, 0, 0, Math.round(frames * 1_000_000.0 / FPS),
                    MediaCodec.BUFFER_FLAG_END_OF_STREAM);
            long deadline = System.currentTimeMillis() + 20_000;
            boolean eosSeen = false;
            while (System.currentTimeMillis() < deadline) {
                int drained = drain(codec, muxer, info, track, true);
                if (drained == -2) { eosSeen = true; break; }
                if (drained >= 0) { track = drained; muxerStarted = true; }
            }
            if (!muxerStarted || !eosSeen) throw new IllegalStateException("硬件编码未完成");
        } finally {
            last.recycle();
            cover.recycle();
            if (codec != null) {
                if (codecStarted) codec.stop();
                codec.release();
            }
            if (muxer != null) {
                if (muxerStarted) muxer.stop();
                muxer.release();
            }
        }
    }

    private static int drain(MediaCodec codec, MediaMuxer muxer, MediaCodec.BufferInfo info,
                             int track, boolean wait) {
        int index = codec.dequeueOutputBuffer(info, wait ? 100_000 : 0);
        if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            if (track >= 0) throw new IllegalStateException("编码器重复改变输出格式");
            int newTrack = muxer.addTrack(codec.getOutputFormat());
            muxer.start();
            return newTrack;
        }
        if (index < 0) return -1;
        try {
            if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && info.size > 0) {
                if (track < 0) throw new IllegalStateException("编码器未提供输出格式");
                ByteBuffer bytes = codec.getOutputBuffer(index);
                if (bytes == null) throw new IllegalStateException("编码器输出为空");
                bytes.position(info.offset);
                bytes.limit(info.offset + info.size);
                muxer.writeSampleData(track, bytes, info);
            }
            return (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0 ? -2 : -1;
        } finally {
            codec.releaseOutputBuffer(index, false);
        }
    }

    private static Bitmap scaledBitmap(byte[] jpeg, int width, int height) {
        Bitmap source = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length);
        if (source == null) throw new IllegalArgumentException("无法解码渐变画面");
        if (source.getWidth() == width && source.getHeight() == height) return source;
        Bitmap result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(result);
        canvas.drawBitmap(source, null, new Rect(0, 0, width, height), null);
        source.recycle();
        return result;
    }

    private static void writeFrame(Image image, Bitmap last, Bitmap cover,
                                   int[] lastRows, int[] coverRows,
                                   int width, int height, double alpha) {
        Image.Plane[] planes = image.getPlanes();
        if (planes.length != 3) throw new IllegalStateException("编码器未提供 YUV420 画面");
        ByteBuffer y = planes[0].getBuffer();
        ByteBuffer u = planes[1].getBuffer();
        ByteBuffer v = planes[2].getBuffer();
        int blend = (int) Math.round(alpha * 256);
        for (int row = 0; row < height; row += 2) {
            last.getPixels(lastRows, 0, width, 0, row, width, 2);
            cover.getPixels(coverRows, 0, width, 0, row, width, 2);
            for (int col = 0; col < width; col += 2) {
                int sumR = 0, sumG = 0, sumB = 0;
                for (int dy = 0; dy < 2; dy++) {
                    for (int dx = 0; dx < 2; dx++) {
                        int at = dy * width + col + dx;
                        int a = lastRows[at], b = coverRows[at];
                        int r = (((a >> 16) & 255) * (256 - blend) + ((b >> 16) & 255) * blend) >> 8;
                        int g = (((a >> 8) & 255) * (256 - blend) + ((b >> 8) & 255) * blend) >> 8;
                        int blue = ((a & 255) * (256 - blend) + (b & 255) * blend) >> 8;
                        int yy = height >= 720
                                ? clamp((47 * r + 157 * g + 16 * blue + 128) / 256 + 16)
                                : clamp((66 * r + 129 * g + 25 * blue + 128) / 256 + 16);
                        y.put((row + dy) * planes[0].getRowStride()
                                + (col + dx) * planes[0].getPixelStride(), (byte) yy);
                        sumR += r; sumG += g; sumB += blue;
                    }
                }
                int r = sumR / 4, g = sumG / 4, blue = sumB / 4;
                int chromaOffset = row / 2 * planes[1].getRowStride() + col / 2 * planes[1].getPixelStride();
                u.put(chromaOffset, (byte) (height >= 720
                        ? clamp((-26 * r - 87 * g + 112 * blue + 128) / 256 + 128)
                        : clamp((-38 * r - 74 * g + 112 * blue + 128) / 256 + 128)));
                chromaOffset = row / 2 * planes[2].getRowStride() + col / 2 * planes[2].getPixelStride();
                v.put(chromaOffset, (byte) (height >= 720
                        ? clamp((112 * r - 102 * g - 10 * blue + 128) / 256 + 128)
                        : clamp((112 * r - 94 * g - 18 * blue + 128) / 256 + 128)));
            }
        }
    }

    private static int clamp(int value) { return Math.max(0, Math.min(255, value)); }
}
