export type TranslationStatus =
  | 'UPLOADING'
  | 'QUEUED'
  | 'IN_PROGRESS'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED';

export interface TranslationJob {
  jobId: string;
  fileName: string;
  sourceLanguage: string;
  targetLanguage: string;
  status: TranslationStatus;
  inputKey: string;
  contentType?: string;
  fileExtension?: string;
  outputKey?: string;
  errorMessage?: string;
  verificationStatus?: 'PENDING' | 'PASSED' | 'FAILED';
  verificationDetails?: string;
  createdAt: string;
  updatedAt: string;
}
