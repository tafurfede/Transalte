import { S3Client } from '@aws-sdk/client-s3';

export const s3 = new S3Client({});
export const BUCKET = process.env.BUCKET;

if (!BUCKET) {
  throw new Error('BUCKET env var is required');
}
