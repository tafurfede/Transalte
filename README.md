# AWS Translate Drag-and-Drop Demo

This repo contains a small full-stack example that lets a user upload a text-based file through a web UI, translate it with Amazon Translate, and download the translated copy.

## Project Structure

```
backend/  # Lambda handlers (TypeScript + AWS SDK v3)
infra/    # AWS SAM template that wires S3, DynamoDB, Lambda, and HttpApi
frontend/ # React + Vite single-page app for drag/drop uploads
```

## Prerequisites

- Node.js 18+
- AWS SAM CLI or AWS CDK (this template uses SAM)
- An AWS account with permissions to deploy S3 buckets, DynamoDB, Lambda, and Amazon Translate

## Backend Setup

```bash
cd backend
npm install
npm run build
```

This bundles the TypeScript handlers into `backend/dist`, which the SAM template consumes. The backend now depends on [Mammoth](https://github.com/mwilliamson/mammoth.js), [pdf-parse](https://github.com/modesty/pdf-parse), [PDFKit](https://pdfkit.org/), and the AWS Translate **Document** APIs to keep DOCX files intact, so re-run `npm install` whenever you pull new changes.

## Infrastructure Deployment (SAM)

```bash
cd infra
sam build
sam deploy --guided
```

During the guided deploy you can keep the defaults, but note the generated HTTP API URL and S3 bucket name—they are needed by the frontend.

## Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env  # then edit VITE_API_BASE with your API Gateway URL
npm run dev           # local dev server
npm run build         # production build (outputs to frontend/dist)
```

The `.env.example` file declares `VITE_API_BASE`. Point it to the value of `ApiUrl` from the SAM outputs (for example `https://abc123.execute-api.us-east-1.amazonaws.com`).

## Workflow

1. User opens the frontend and drops a `.txt`, `.md`, `.json`, `.docx`, or `.pdf` file.
2. Frontend requests a presigned POST + job id from `POST /upload-url`.
3. File uploads directly to S3 using the provided form fields.
4. The S3 `ObjectCreated` event triggers `processUpload`, which:
   - Updates the job row in DynamoDB.
   - Reads the uploaded object (DOCX text extracted via Mammoth, PDFs via pdf-parse, other text via UTF‑8).
   - Uses Amazon Translate **Document** for DOCX files (to preserve layout) and `TranslateText`/PDFKit for other formats.
   - Runs an automatic language verification (Comprehend `DetectDominantLanguage`) before writing the translated artifact back to S3 as `translated/{jobId}/{originalName}-<Language>.ext`.
5. Frontend polls `GET /status/{jobId}` until the job is `COMPLETED` *and verified*, then surfaces the signed download link.

## Testing

- **Unit tests**: add Jest or Vitest to `backend` for handler logic (utility functions, Dynamo updates, etc.).
- **Integration**: `sam local generate-event s3 put | sam local invoke ProcessUploadFunction -e event.json` to simulate uploads.
- **Frontend**: Vite dev server + React Testing Library for components. Cypress or Playwright can cover the drag/drop flow.

## Next Steps

- Persist larger files by switching `processUpload` to `StartTextTranslationJob`.
- Add authentication (Cognito or OAuth) before issuing presigned uploads.
- Replace polling with webhooks or WebSocket notifications.
- Expand language picker and surface translation preview inline.
