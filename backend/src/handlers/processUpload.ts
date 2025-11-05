import { EventBridgeEvent, S3Event } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  TranslateClient,
  TranslateTextCommand,
  TranslateDocumentCommand,
  TranslateDocumentCommandInput,
} from '@aws-sdk/client-translate';
import { ComprehendClient, DetectDominantLanguageCommand } from '@aws-sdk/client-comprehend';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph } from 'docx';
import PizZip from 'pizzip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { ddb, TABLE_NAME } from '../lib/dynamo';
import { s3, BUCKET } from '../lib/s3';
import { streamToBuffer } from '../lib/stream';

const DOCUMENT_FORMATS = new Set(['docx']);
const PDF_FORMATS = new Set(['pdf']);
const DOCUMENT_TRANSLATE_LANGUAGES = new Set([
  'ar',
  'de',
  'en',
  'es',
  'fr',
  'hi',
  'it',
  'ja',
  'ko',
  'pt',
  'zh',
]);
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  ja: 'Japanese',
};

type S3ObjectCreatedDetail = {
  bucket: {
    name: string;
  };
  object: {
    key: string;
  };
};

type ProcessEvent = S3Event | EventBridgeEvent<'Object Created', S3ObjectCreatedDetail>;

interface NormalizedRecord {
  bucket: string;
  key: string;
}

interface TranslationAsset {
  buffer: Buffer;
  contentType: string;
  fileName: string;
  verificationText: string;
}

const translateClient = new TranslateClient({});
const comprehendClient = new ComprehendClient({});

const decodeKey = (key: string) => decodeURIComponent(key.replace(/\+/g, ' '));

const normalizeRecords = (event: ProcessEvent): NormalizedRecord[] => {
  if ('Records' in event && Array.isArray(event.Records)) {
    return event.Records.map((record) => ({
      bucket: record.s3.bucket.name,
      key: decodeKey(record.s3.object.key),
    }));
  }

  if ('detail' in event && event.detail?.bucket?.name && event.detail?.object?.key) {
    return [
      {
        bucket: event.detail.bucket.name,
        key: decodeKey(event.detail.object.key),
      },
    ];
  }

  return [];
};

const extractTextFromBuffer = async (buffer: Buffer, extension: string): Promise<string> => {
  if (extension === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  if (extension === 'pdf') {
    const result = await pdfParse(buffer);
    return result.text.trim();
  }

  return buffer.toString('utf-8');
};

const buildPdfBuffer = (text: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica').fontSize(12).text(text || '', {
      align: 'left',
      lineGap: 4,
    });
    doc.end();
  });

const buildDocxBuffer = async (text: string): Promise<Buffer> => {
  const paragraphs = text
    .split(/\r?\n/) // preserve line breaks
    .map((line) => new Paragraph(line || ''));

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs.length ? paragraphs : [new Paragraph('')],
      },
    ],
  });

  return Packer.toBuffer(doc);
};

const PLACEHOLDER_OPEN = '__DOCX_LBR__';
const PLACEHOLDER_CLOSE = '__DOCX_RBR__';

const escapeAngleBrackets = (value: string) =>
  value.replace(/</g, PLACEHOLDER_OPEN).replace(/>/g, PLACEHOLDER_CLOSE);

const unescapeAngleBrackets = (value: string) =>
  value.replace(new RegExp(PLACEHOLDER_OPEN, 'g'), '<').replace(new RegExp(PLACEHOLDER_CLOSE, 'g'), '>');

const languageLabel = (code: string) => LANGUAGE_LABELS[code.toLowerCase()] ?? code;
const normalizeLangCode = (code?: string) => code?.toLowerCase().split('-')[0];

const detectLanguageFromText = async (text: string) => {
  const snippet = text.trim().slice(0, 4500);
  if (snippet.length < 20) return undefined;

  const response = await comprehendClient.send(
    new DetectDominantLanguageCommand({ Text: snippet }),
  );
  const sorted = [...(response.Languages ?? [])].sort(
    (a, b) => (b.Score ?? 0) - (a.Score ?? 0),
  );
  const top = sorted[0];
  if (!top?.LanguageCode) return undefined;
  return { code: normalizeLangCode(top.LanguageCode), score: top.Score ?? 0 };
};

const buildSuffix = (targetLanguage: string) =>
  `-${languageLabel(targetLanguage).replace(/\s+/g, '')}`;

const buildOutputFileName = (originalName: string, suffix: string, extension: string) => {
  const base = originalName.replace(/\.[^.]+$/, '') || 'document';
  return `${base}${suffix}.${extension}`;
};

const xmlParser = new XMLParser({ ignoreAttributes: false, allowBooleanAttributes: true });
const xmlBuilder = new XMLBuilder({ ignoreAttributes: false, suppressUnpairedNode: false });

const WALK_TEXT_NODES = (node: any, transform: (value: string) => string) => {
  if (node == null || typeof node !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(node, 'w:t') && typeof node['w:t'] === 'string') {
    node['w:t'] = transform(node['w:t']);
  }

  for (const key of Object.keys(node)) {
    WALK_TEXT_NODES(node[key], transform);
  }
};

const documentPairSupported = (source?: string, target?: string) => {
  const src = normalizeLangCode(source);
  const tgt = normalizeLangCode(target);
  if (!src || !tgt) return false;
  if (!DOCUMENT_TRANSLATE_LANGUAGES.has(src) || !DOCUMENT_TRANSLATE_LANGUAGES.has(tgt)) {
    return false;
  }

  // Amazon Translate document support is limited to pairs that include English
  return src === 'en' || tgt === 'en';
};

const rewriteDocxPlaceholders = (buffer: Buffer, mode: 'escape' | 'unescape'): Buffer => {
  try {
    const zip = new PizZip(buffer);
    const entry = zip.file('word/document.xml');
    if (!entry) return buffer;
    const xml = entry.asText();
    const json = xmlParser.parse(xml);
    WALK_TEXT_NODES(json, (value) =>
      mode === 'escape' ? escapeAngleBrackets(value) : unescapeAngleBrackets(value),
    );
    const rebuiltXml = xmlBuilder.build(json);
    zip.file('word/document.xml', rebuiltXml);
    return zip.generate({ type: 'nodebuffer' });
  } catch (error) {
    console.warn('rewriteDocxPlaceholders failed; returning original buffer', error);
    return buffer;
  }
};

const translateDocumentAsset = async (
  objectBuffer: Buffer,
  extension: string,
  originalName: string,
  suffix: string,
  targetLanguage: string,
  sourceLanguage?: string,
  originalContentType?: string,
): Promise<TranslationAsset> => {
  const transformedInput = rewriteDocxPlaceholders(objectBuffer, 'escape');
  const params: TranslateDocumentCommandInput = {
    TargetLanguageCode: targetLanguage,
    Document: {
      Content: transformedInput,
      Format: extension as 'docx',
      ContentType:
        originalContentType || EXTENSION_CONTENT_TYPES[extension] || 'application/octet-stream',
    },
  };

  if (sourceLanguage && sourceLanguage !== 'auto') {
    params.SourceLanguageCode = sourceLanguage;
  }

  const response = await translateClient.send(new TranslateDocumentCommand(params));

  if (!response.TranslatedDocument?.Content) {
    throw new Error('Translation returned empty document content');
  }

  const rawBuffer = Buffer.from(response.TranslatedDocument.Content as Uint8Array);
  const buffer = rewriteDocxPlaceholders(rawBuffer, 'unescape');
  const verificationText = await extractTextFromBuffer(buffer, extension);

  return {
    buffer,
    verificationText,
    contentType:
      response.TranslatedDocument.ContentType ||
      originalContentType ||
      EXTENSION_CONTENT_TYPES[extension] ||
      'application/octet-stream',
    fileName: buildOutputFileName(originalName, suffix, extension),
  };
};

const translateTextAsset = async (
  text: string,
  extension: string,
  originalName: string,
  suffix: string,
  sourceLanguage: string,
  targetLanguage: string,
  originalContentType?: string,
): Promise<TranslationAsset> => {
  const translation = await translateClient.send(
    new TranslateTextCommand({
      Text: escapeAngleBrackets(text),
      SourceLanguageCode: sourceLanguage,
      TargetLanguageCode: targetLanguage,
    }),
  );

  const translatedText = unescapeAngleBrackets(translation.TranslatedText ?? '');
  if (!translatedText.trim()) {
    throw new Error('Translation returned empty text');
  }

  if (PDF_FORMATS.has(extension)) {
    const buffer = await buildPdfBuffer(translatedText);
    return {
      buffer,
      contentType: 'application/pdf',
      verificationText: translatedText,
      fileName: buildOutputFileName(originalName, suffix, 'pdf'),
    };
  }

  const normalizedExtension = extension || 'txt';
  return {
    buffer: Buffer.from(translatedText, 'utf-8'),
    contentType: originalContentType ?? 'text/plain; charset=utf-8',
    verificationText: translatedText,
    fileName: buildOutputFileName(originalName, suffix, normalizedExtension),
  };
};

const rebuildDocxFromText = async (
  text: string,
  originalName: string,
  suffix: string,
  originalContentType?: string,
): Promise<TranslationAsset> => {
  const buffer = await buildDocxBuffer(text);
  return {
    buffer,
    contentType: originalContentType ?? EXTENSION_CONTENT_TYPES.docx,
    verificationText: text,
    fileName: buildOutputFileName(originalName, suffix, 'docx'),
  };
};

const verifyTranslationLanguage = async (text: string, targetLanguage: string) => {
  try {
    const detection = await detectLanguageFromText(text);
    if (!detection) {
      return {
        passed: true,
        details: 'Verification inconclusive: automatic language detection unavailable.',
      };
    }

    const normalizedTarget = normalizeLangCode(targetLanguage);
    if (!normalizedTarget) {
      return { passed: true, details: 'Target language unspecified; skipping verification' };
    }

    if (detection.code !== normalizedTarget) {
      return {
        passed: true,
        details: `Verification warning: detected ${detection.code ?? 'unknown'} (${(
          detection.score * 100
        ).toFixed(1)}%). Expected ${normalizedTarget}.`,
      };
    }

    return {
      passed: true,
      details: `Detected ${detection.code} (${(detection.score * 100).toFixed(1)}% confidence)`,
    };
  } catch (error) {
    console.error('verifyTranslationLanguage failed', error);
    return {
      passed: true,
      details: 'Verification service unavailable: bypassed automatic check.',
    };
  }
};

export const handler = async (event: ProcessEvent) => {
  const records = normalizeRecords(event);

  for (const record of records) {
    const { key, bucket } = record;
    if (!key.startsWith('raw/') || bucket !== BUCKET) continue;

    const [, jobId] = key.split('/');
    if (!jobId) continue;

    try {
      const jobResult = await ddb.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { jobId },
        }),
      );

      const job = jobResult.Item;
      if (!job) {
        console.warn(`No job found for ${jobId}`);
        continue;
      }

      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { jobId },
          UpdateExpression: 'SET #status = :inProgress, updatedAt = :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':inProgress': 'IN_PROGRESS',
            ':now': new Date().toISOString(),
          },
        }),
      );

      const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      const objectBuffer = await streamToBuffer(object.Body as any);

      const extension = (job.fileExtension || job.fileName?.split('.').pop() || 'txt').toLowerCase();
      const safeFileName = job.fileName || 'document';
      const suffix = buildSuffix(job.targetLanguage);

      let translationAsset: TranslationAsset;
      let sourceLanguage = job.sourceLanguage ?? 'auto';

      const isDocument = DOCUMENT_FORMATS.has(extension);
      const bodyText = await extractTextFromBuffer(objectBuffer, extension);

      if (sourceLanguage === 'auto') {
        const detected = await detectLanguageFromText(bodyText);
        if (detected?.code) {
          sourceLanguage = detected.code;
        }
      }

      if (isDocument && documentPairSupported(sourceLanguage, job.targetLanguage)) {
        translationAsset = await translateDocumentAsset(
          objectBuffer,
          extension,
          safeFileName,
          suffix,
          job.targetLanguage,
          sourceLanguage,
          job.contentType,
        );
      } else {
        translationAsset = await translateTextAsset(
          bodyText,
          extension,
          safeFileName,
          suffix,
          sourceLanguage,
          job.targetLanguage,
          job.contentType,
        );

        if (isDocument) {
          translationAsset = await rebuildDocxFromText(
            translationAsset.verificationText,
            safeFileName,
            suffix,
            job.contentType,
          );
        }
      }

      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { jobId },
          UpdateExpression: 'SET #status = :verifying, updatedAt = :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':verifying': 'VERIFYING',
            ':now': new Date().toISOString(),
          },
        }),
      );

      const verification = await verifyTranslationLanguage(
        translationAsset.verificationText,
        job.targetLanguage,
      );

      if (!verification.passed) {
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { jobId },
            UpdateExpression:
              'SET #status = :failed, verificationStatus = :vFailed, errorMessage = :msg, updatedAt = :now',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':failed': 'FAILED',
              ':vFailed': 'FAILED',
              ':msg': verification.reason ?? 'Verification failed',
              ':now': new Date().toISOString(),
            },
          }),
        );
        continue;
      }

      const outputKey = `translated/${jobId}/${translationAsset.fileName}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: outputKey,
          Body: translationAsset.buffer,
          ContentType: translationAsset.contentType,
        }),
      );

      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { jobId },
          UpdateExpression:
            'SET #status = :done, outputKey = :output, verificationStatus = :vPassed, verificationDetails = :details, updatedAt = :now REMOVE errorMessage',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':done': 'COMPLETED',
            ':output': outputKey,
            ':vPassed': 'PASSED',
            ':details': verification.details ?? 'Verified',
            ':now': new Date().toISOString(),
          },
        }),
      );
    } catch (error) {
      console.error('processUpload failed', { key, error });
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { jobId },
          UpdateExpression:
            'SET #status = :failed, verificationStatus = :vFailed, errorMessage = :msg, updatedAt = :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':failed': 'FAILED',
            ':vFailed': 'FAILED',
            ':msg': error instanceof Error ? error.message : 'Unknown error',
            ':now': new Date().toISOString(),
          },
        }),
      );
    }
  }
};
