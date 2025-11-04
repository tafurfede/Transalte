declare module 'mammoth' {
  interface ExtractResult {
    value: string;
  }
  interface ExtractOptions {
    buffer: Buffer;
  }
  export function extractRawText(options: ExtractOptions): Promise<ExtractResult>;
}
