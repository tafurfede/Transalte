import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { fetchStatus, requestUploadUrl, triggerProcess } from './api';
import { TranslationJob } from './types';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ja', label: 'Japanese' },
];

const FORMATS = [
  { code: 'docx', label: 'DOCX' },
  { code: 'xml', label: 'XML' },
];

const POLL_INTERVAL = 3000;
const MAX_FILES_PER_BATCH = 10;

type JobState = {
  job: TranslationJob;
  downloadUrl: string;
};

function App() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [targetLanguage, setTargetLanguage] = useState('es');
  const [targetFormat, setTargetFormat] = useState<'docx' | 'xml'>('xml');
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  const [error, setError] = useState('');
  const [isUploading, setUploading] = useState(false);
  const pollingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const jobEntries = useMemo(() => Object.entries(jobs), [jobs]);
  const hasActiveJobs = useMemo(
    () => jobEntries.some(([, data]) => !['COMPLETED', 'FAILED'].includes(data.job.status)),
    [jobEntries],
  );

  const getStatusMessage = useCallback((currentJob?: TranslationJob | null) => {
    if (!currentJob) return 'Waiting to start translation…';
    if (currentJob.status === 'FAILED') return currentJob.errorMessage ?? 'Translation failed';
    if (currentJob.status === 'VERIFYING') return 'Checking translated file before release…';
    if (currentJob.status === 'COMPLETED') {
      return currentJob.verificationDetails
        ? `Translation ready (${currentJob.verificationDetails})`
        : 'Translation ready';
    }
    return `Current status: ${currentJob.status}`;
  }, []);

  const clearTimer = useCallback((jobId: string) => {
    const existing = pollingTimers.current[jobId];
    if (existing) {
      clearTimeout(existing);
      delete pollingTimers.current[jobId];
    }
  }, []);

  useEffect(
    () => () => {
      Object.values(pollingTimers.current).forEach((timer) => clearTimeout(timer));
    },
    [],
  );

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles?.length) {
      if (acceptedFiles.length > MAX_FILES_PER_BATCH) {
        setError(
          `Select up to ${MAX_FILES_PER_BATCH} files per batch. Only the first ${MAX_FILES_PER_BATCH} were added.`,
        );
      } else {
        setError('');
      }
      setSelectedFiles(acceptedFiles.slice(0, MAX_FILES_PER_BATCH));
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    maxSize: 5 * 1024 * 1024,
    accept: {
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
      'application/json': ['.json'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/pdf': ['.pdf'],
    },
  });

  const disabled = !selectedFiles.length || isUploading;

  const pollJobStatus = useCallback(
    (jobId: string) => {
      const run = async () => {
        try {
          const result = await fetchStatus(jobId);
          setJobs((prev) => ({
            ...prev,
            [jobId]: {
              ...(prev[jobId] ?? { downloadUrl: '' }),
              job: result.job,
              downloadUrl: result.downloadUrl ?? '',
            },
          }));

          if (!['COMPLETED', 'FAILED'].includes(result.job.status)) {
            clearTimer(jobId);
            pollingTimers.current[jobId] = setTimeout(run, POLL_INTERVAL);
          } else {
            clearTimer(jobId);
          }
        } catch (err) {
          console.error(err);
          setError('Failed to fetch job status. Retrying…');
          clearTimer(jobId);
          pollingTimers.current[jobId] = setTimeout(run, POLL_INTERVAL * 2);
        }
      };

      run();
    },
    [clearTimer, setError],
  );

  const startTranslationForFile = useCallback(
    async (file: File) => {
      const extension = file.name.split('.').pop();
      const { jobId: newJobId, upload } = await requestUploadUrl({
        fileName: file.name,
        targetLanguage,
        outputFormat: targetFormat,
        contentType: file.type || 'text/plain',
      });

      const isPostUpload = Boolean((upload.fields as Record<string, string | undefined>)?.key);
      let response: Response;

      if (isPostUpload) {
        const formData = new FormData();
        Object.entries(upload.fields).forEach(([key, value]) => {
          formData.append(key, value);
        });
        formData.append('file', file);

        response = await fetch(upload.url, {
          method: 'POST',
          body: formData,
        });
      } else {
        const headers: Record<string, string> = {};
        const hintedType = upload.fields?.['Content-Type'] || file.type || 'application/octet-stream';
        if (hintedType) headers['Content-Type'] = hintedType;

        response = await fetch(upload.url, {
          method: 'PUT',
          headers,
          body: file,
        });
      }

      if (!response.ok) {
        throw new Error('Upload to S3 failed');
      }

      try {
        await triggerProcess(newJobId);
      } catch (processError) {
        console.error('Process trigger failed', processError);
      }

      const now = new Date().toISOString();
      const placeholder: TranslationJob = {
        jobId: newJobId,
        fileName: file.name,
        sourceLanguage: 'auto',
        targetLanguage,
        outputFormat: targetFormat,
        status: 'UPLOADING',
        inputKey: (upload.fields as any)?.key || `raw/${newJobId}/${file.name}`,
        contentType: file.type,
        fileExtension: extension?.toLowerCase(),
        verificationStatus: 'PENDING',
        createdAt: now,
        updatedAt: now,
      };

      setJobs((prev) => ({
        ...prev,
        [newJobId]: { job: placeholder, downloadUrl: '' },
      }));

      pollJobStatus(newJobId);
    },
    [pollJobStatus, targetLanguage, targetFormat],
  );

  const handleUpload = async () => {
    if (!selectedFiles.length) {
      setError('Please select at least one file');
      return;
    }

    setError('');
    setUploading(true);

    let encounteredError = false;
    for (const file of selectedFiles.slice(0, MAX_FILES_PER_BATCH)) {
      try {
        await startTranslationForFile(file);
      } catch (err) {
        console.error(err);
        encounteredError = true;
      }
    }

    if (encounteredError) {
      setError('Some files could not be uploaded. Check the console and API logs.');
    }

    setUploading(false);
  };

  return (
    <div className="page">
      <header>
        <h1>TIMS Document Translate</h1>
        <p>Securely submit internal documents, choose the destination language, and receive a reviewed translation ready for clients.</p>
      </header>

      <section className="card">
        <div className={`dropzone ${isDragActive ? 'active' : ''}`} {...getRootProps()}>
          <input {...getInputProps()} />
          {selectedFiles.length ? (
            <div>
              <p>
                {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} selected (max {MAX_FILES_PER_BATCH} per batch)
              </p>
              <ul className="file-list">
                {selectedFiles.map((file) => (
                  <li key={`${file.name}-${file.lastModified}`}>{file.name}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p>Drag & drop up to {MAX_FILES_PER_BATCH} .txt/.md/.json/.docx/.pdf files, or click to select</p>
          )}
        </div>

        <label className="language-picker">
          Target language
          <select value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)}>
            {LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </label>

        <label className="language-picker">
          Target format
          <select value={targetFormat} onChange={(e) => setTargetFormat(e.target.value as 'docx' | 'xml')}>
            {FORMATS.map((format) => (
              <option key={format.code} value={format.code}>
                {format.label}
              </option>
            ))}
          </select>
        </label>

        <button className="primary" onClick={handleUpload} disabled={disabled}>
          {isUploading ? 'Uploading…' : 'Start translations'}
        </button>

        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h2>Status</h2>
        {!jobEntries.length && <p>No active jobs yet.</p>}
        {jobEntries.length > 0 && (
          <>
            {hasActiveJobs && <p className="muted">Polling AWS for updates…</p>}
            <ul className="job-list">
              {jobEntries.map(([jobId, data]) => {
                const displayName =
                  (data.job.outputKey && data.job.outputKey.split('/').pop()) || data.job.fileName;
                return (
                  <li key={jobId} className="job-row">
                    <div>
                      <strong>{displayName}</strong>
                      <p className="muted">{getStatusMessage(data.job)}</p>
                      {data.job.status === 'FAILED' && data.job.errorMessage && (
                        <p className="error">{data.job.errorMessage}</p>
                      )}
                    </div>
                    {data.downloadUrl &&
                      data.job.status === 'COMPLETED' &&
                      data.job.verificationStatus === 'PASSED' && (
                        <a
                          href={data.downloadUrl}
                          className="primary"
                          target="_blank"
                          rel="noreferrer"
                          download={displayName}
                        >
                          Download
                        </a>
                      )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

export default App;
