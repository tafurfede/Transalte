import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'node:crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../lib/dynamo';
import { BUCKET, s3 } from '../lib/s3';

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB demo limit
const ALLOWED_EXTENSIONS = new Set(['txt', 'md', 'json', 'docx', 'pdf']);
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

interface RequestBody {
  fileName?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  contentType?: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const payload = (event.body ? JSON.parse(event.body) : {}) as RequestBody;
    const { fileName, targetLanguage, sourceLanguage, contentType } = payload;

    if (!fileName || !targetLanguage) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ message: 'fileName and targetLanguage are required' }),
      };
    }

    const jobId = randomUUID();
    const extension = fileName.split('.').pop()?.toLowerCase();

    if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ message: 'Unsupported file type' }),
      };
    }

    const resolvedContentType = contentType || EXTENSION_CONTENT_TYPES[extension] || 'application/octet-stream';
    const key = `raw/${jobId}/${fileName}`;

    const post = await createPresignedPost(
      s3,
      {
        Bucket: BUCKET,
        Key: key,
        Conditions: [['content-length-range', 1, MAX_UPLOAD_SIZE]],
        Fields: {
          'Content-Type': resolvedContentType,
        },
        Expires: 300,
      },
    );

    const now = new Date().toISOString();
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          jobId,
          fileName,
          sourceLanguage: sourceLanguage ?? 'auto',
          targetLanguage,
          status: 'UPLOADING',
          inputKey: key,
          contentType: resolvedContentType,
          fileExtension: extension,
          verificationStatus: 'PENDING',
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ jobId, upload: post }),
    };
  } catch (error) {
    console.error('createUploadUrl failed', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Failed to create upload URL' }),
    };
  }
};

const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
});
