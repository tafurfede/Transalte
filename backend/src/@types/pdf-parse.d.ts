declare module 'pdf-parse' {
  interface PDFMetadata {
    info: Record<string, any>;
    metadata?: any;
    version?: string;
    producer?: string;
    creator?: string;
  }

  interface PDFData {
    numpages: number;
    numrender: number;
    info: Record<string, any>;
    metadata: any;
    text: string;
    version: string;
  }

  function pdfParse(data: Buffer, options?: Record<string, unknown>): Promise<PDFData>;
  export default pdfParse;
}
