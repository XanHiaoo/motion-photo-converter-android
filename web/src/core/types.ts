export type MotionFormat =
  | 'Samsung Motion Photo'
  | 'Android Motion Photo'
  | '内嵌动态照片'
  | 'Apple Live Photo 组件'
  | '普通图片'
  | '普通视频'
  | '未知格式';

export interface Mp4Atom {
  type: string;
  offset: number;
  size: number;
}

export interface ValidationReport {
  isMotionPhoto: boolean;
  isSamsungCompatible: boolean;
  imageValid: boolean;
  videoValid: boolean;
  xmpValid: boolean;
  offsetValid: boolean;
  containerValid: boolean;
  presentationTimestampValid: boolean;
  trailerValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface MediaAnalysis {
  fileName: string;
  mime: string;
  size: number;
  format: MotionFormat;
  staticFormat: 'JPEG' | 'HEIC/HEIF' | 'Unknown';
  videoFormat: 'MP4' | 'MOV/QuickTime' | 'Unknown' | null;
  imageSize: number | null;
  videoStart: number | null;
  videoSize: number | null;
  jpegEoi: number | null;
  xmp: string | null;
  hasXmp: boolean;
  hasSamsungTrailer: boolean;
  presentationTimestampUs: number | null;
  contentIdentifier: string | null;
  codec: string | null;
  durationSeconds: number | null;
  mp4Atoms: Mp4Atom[];
  validation: ValidationReport;
}

export interface SamsungTrailerInfo {
  trailerStart: number;
  videoStart: number;
  videoSize: number;
  sefStart: number;
  fieldSize: number;
}

export interface PairCandidate {
  id: string;
  image: File;
  video: File | null;
  match: 'metadata' | 'filename' | 'manual' | 'none';
}
