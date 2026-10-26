export interface PromoteMediaFileInput {
  srcPath: string;
  sessionId: string;
  externalMessageId: string;
  mimeType: string;
}

export interface PromotedMediaFile {
  publicUrl: string;
  localPath: string;
  sizeBytes: number;
}

/** Handle to a media file materialized on local disk; call `release` when done. */
export interface AcquiredMediaFile {
  filePath: string;
  sizeBytes: number;
  /** Noop for local; deletes temp file for remote stores. */
  release(): Promise<void>;
}

export interface IMediaFileStore {
  promote(input: PromoteMediaFileInput): Promise<PromotedMediaFile>;

  /** Save raw buffer as a named media file; returns the public URL. */
  saveBuffer(buffer: Buffer, filename: string): Promise<string>;
  /** Whether a media file with this filename exists in the store. */
  mediaExists(filename: string): Promise<boolean>;
  /** Public URL for a given filename. */
  publicUrl(filename: string): string;

  /**
   * Materialize a media URL as a local file for reading (e.g. outbound dispatch).
   * Local store returns the existing path; remote stores download to a temp file.
   * Returns `null` if the URL doesn't belong to this store or the file is gone.
   */
  acquireLocalFile(mediaUrl: string): Promise<AcquiredMediaFile | null>;

  /** @deprecated Use `acquireLocalFile` for new code. */
  resolveLocalPath(mediaUrl: string): string | null;
  remove(localPath: string): Promise<void>;
  exists(localPath: string): Promise<boolean>;
}
