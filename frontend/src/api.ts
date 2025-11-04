import axios from 'axios';
import { TranslationJob } from './types';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || 'http://localhost:3000',
});

export interface UploadRequest {
  fileName: string;
  targetLanguage: string;
  sourceLanguage?: string;
  contentType?: string;
}

export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
}

export interface CreateUploadResponse {
  jobId: string;
  upload: PresignedPost;
}

export const requestUploadUrl = async (body: UploadRequest): Promise<CreateUploadResponse> => {
  const { data } = await api.post<CreateUploadResponse>('/upload-url', body);
  return data;
};

export interface StatusResponse {
  job: TranslationJob;
  downloadUrl?: string;
}

export const fetchStatus = async (jobId: string): Promise<StatusResponse> => {
  const { data } = await api.get<StatusResponse>(`/status/${jobId}`);
  return data;
};
