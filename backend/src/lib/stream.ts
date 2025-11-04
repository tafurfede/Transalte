import { Readable } from 'node:stream';

type StreamLike = Readable | Blob | ReadableStream | undefined;

export const streamToBuffer = async (body: StreamLike): Promise<Buffer> => {
  if (!body) return Buffer.alloc(0);

  if (body instanceof Readable) {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      body.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      body.on('error', reject);
      body.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  if (typeof (body as Blob).arrayBuffer === 'function') {
    const buffer = await (body as Blob).arrayBuffer();
    return Buffer.from(buffer);
  }

  const reader = (body as ReadableStream).getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
};

export const streamToString = async (body: StreamLike): Promise<string> => {
  const buffer = await streamToBuffer(body);
  return buffer.toString('utf-8');
};
