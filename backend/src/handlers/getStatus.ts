import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ddb, TABLE_NAME } from '../lib/dynamo';
import { s3, BUCKET } from '../lib/s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const jobId = event.pathParameters?.jobId;
  if (!jobId) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'jobId path parameter is required' }),
    };
  }

  try {
    const job = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { jobId },
      }),
    );

    if (!job.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ message: 'Job not found' }),
      };
    }

    let downloadUrl: string | undefined;
    if (job.Item.outputKey) {
      downloadUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: BUCKET, Key: job.Item.outputKey }),
        { expiresIn: 60 * 10 },
      );
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ job: job.Item, downloadUrl }),
    };
  } catch (error) {
    console.error('getStatus failed', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Failed to fetch job status' }),
    };
  }
};

const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
});
