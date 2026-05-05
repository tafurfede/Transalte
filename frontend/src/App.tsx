import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Languages,
  Upload,
  FileText,
  Download,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Inbox,
  Settings,
  HelpCircle,
} from 'lucide-react';
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
const MAX_FILES_PER_BATCH = 50;

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
  const readyDownloads = useMemo(
    () =>
      jobEntries.filter(
        ([, data]) =>
          data.downloadUrl && data.job.status === 'COMPLETED' && data.job.verificationStatus === 'PASSED',
      ),
    [jobEntries],
  );

  const getStatusMessage = useCallback((currentJob?: TranslationJob | null) => {
    if (!currentJob) return 'Waiting to start translation...';
    if (currentJob.status === 'FAILED') return currentJob.errorMessage ?? 'Translation failed';
    if (currentJob.status === 'VERIFYING') return 'Verifying translated file...';
    if (currentJob.status === 'COMPLETED') {
      return currentJob.verificationDetails
        ? `Ready (${currentJob.verificationDetails})`
        : 'Translation ready';
    }
    return `${currentJob.status}`;
  }, []);

  const getStatusVariant = useCallback((status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'success';
      case 'FAILED':
        return 'error';
      case 'IN_PROGRESS':
      case 'VERIFYING':
        return 'warning';
      default:
        return 'default';
    }
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

  const computeDisplayName = useCallback((data: JobState) => {
    return (data.job.outputKey && data.job.outputKey.split('/').pop()) || data.job.fileName;
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles?.length) {
      if (acceptedFiles.length > MAX_FILES_PER_BATCH) {
        setError(`Max ${MAX_FILES_PER_BATCH} files per batch. Only first ${MAX_FILES_PER_BATCH} were added.`);
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
          setError('Failed to fetch job status. Retrying...');
          clearTimer(jobId);
          pollingTimers.current[jobId] = setTimeout(run, POLL_INTERVAL * 2);
        }
      };

      run();
    },
    [clearTimer],
  );

  const downloadAllReady = useCallback(async () => {
    if (!readyDownloads.length) return;

    for (const [, data] of readyDownloads) {
      const displayName = computeDisplayName(data);
      try {
        const response = await fetch(data.downloadUrl);
        if (!response.ok) throw new Error('Download failed');
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = displayName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);
      } catch (err) {
        console.error('Download failed', err);
        setError('Some files could not be downloaded.');
        break;
      }
    }
  }, [computeDisplayName, readyDownloads]);

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
      setError('Some files could not be uploaded. Check the console.');
    }

    setUploading(false);
  };

  const renderStatusIcon = (status: string, verificationStatus?: string) => {
    if (status === 'COMPLETED' && verificationStatus === 'PASSED')
      return <CheckCircle className="icon-success" />;
    if (status === 'FAILED' || verificationStatus === 'FAILED')
      return <XCircle className="icon-error" />;
    if (['IN_PROGRESS', 'VERIFYING', 'UPLOADING', 'QUEUED'].includes(status))
      return <div className="spinner spinner-sm" />;
    return <Clock className="icon-pending" />;
  };

  return (
    <div className="app-shell">
      <div className="app-layout">
        {/* ── Sidebar ── */}
        <nav className="sidebar">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">
              <Languages size={16} />
            </div>
            <span className="sidebar-logo-text">TIMS Translate</span>
          </div>

          <div className="sidebar-section-label">Main</div>
          <div className="sidebar-item active">
            <Upload size={16} />
            <span>Translate</span>
          </div>
          <div className="sidebar-item">
            <Inbox size={16} />
            <span>History</span>
          </div>

          <div className="sidebar-spacer" />

          <div className="sidebar-section-label">System</div>
          <div className="sidebar-item">
            <Settings size={16} />
            <span>Settings</span>
          </div>
          <div className="sidebar-item">
            <HelpCircle size={16} />
            <span>Help</span>
          </div>
        </nav>

        {/* ── Main Content Panel ── */}
        <main className="main-panel">
          {/* Page Header */}
          <div className="page-header">
            <div>
              <div className="page-header-left">
                <Languages size={18} />
                <h1 className="page-title">Document Translate</h1>
              </div>
              <p className="page-subtitle">
                Securely translate documents with automatic language detection and verification
              </p>
            </div>
          </div>

          {/* Content */}
          <div className="content-area">
            {/* Upload Card */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Upload Documents</span>
              </div>
              <div className="card-body">
                {/* Dropzone */}
                <div
                  {...getRootProps()}
                  className={`dropzone ${isDragActive ? 'active' : ''}`}
                >
                  <input {...getInputProps()} />
                  <div className="dropzone-icon">
                    <Upload size={28} />
                  </div>
                  {selectedFiles.length ? (
                    <>
                      <p className="dropzone-text" style={{ fontWeight: 500 }}>
                        {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} selected
                      </p>
                      <div className="file-chips">
                        {selectedFiles.slice(0, 5).map((file) => (
                          <span className="file-chip" key={`${file.name}-${file.lastModified}`}>
                            <FileText size={12} />
                            {file.name}
                          </span>
                        ))}
                        {selectedFiles.length > 5 && (
                          <span className="file-chip">+{selectedFiles.length - 5} more</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="dropzone-text">Drag & drop files here, or click to select</p>
                      <p className="dropzone-hint">
                        Supports .txt, .md, .json, .docx, .pdf (max 5MB each)
                      </p>
                    </>
                  )}
                </div>

                {/* Options */}
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Target Language</label>
                    <select
                      className="form-select"
                      value={targetLanguage}
                      onChange={(e) => setTargetLanguage(e.target.value)}
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Output Format</label>
                    <select
                      className="form-select"
                      value={targetFormat}
                      onChange={(e) => setTargetFormat(e.target.value as 'docx' | 'xml')}
                    >
                      {FORMATS.map((format) => (
                        <option key={format.code} value={format.code}>
                          {format.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Upload Button */}
                <button
                  className="btn btn-primary btn-full"
                  disabled={disabled}
                  onClick={handleUpload}
                >
                  {isUploading ? (
                    <>
                      <div className="spinner spinner-sm" style={{ borderTopColor: 'var(--admin-bg-panel)' }} />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload size={14} />
                      Start Translation
                    </>
                  )}
                </button>

                {error && (
                  <div className="alert-error">
                    <AlertCircle size={14} />
                    {error}
                  </div>
                )}
              </div>
            </div>

            {/* Status Card */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Translation Status</span>
                {readyDownloads.length > 0 && (
                  <button className="btn btn-success" onClick={downloadAllReady}>
                    <Download size={14} />
                    Download All ({readyDownloads.length})
                  </button>
                )}
              </div>
              <div className="card-body">
                {hasActiveJobs && (
                  <div className="progress-bar">
                    <div className="progress-bar-fill" />
                  </div>
                )}

                {!jobEntries.length ? (
                  <div className="empty-state">
                    <Clock size={36} />
                    <p>No translations yet</p>
                  </div>
                ) : (
                  <div className="job-list">
                    {jobEntries.map(([jobId, data]) => {
                      const displayName = computeDisplayName(data);
                      const canDownload =
                        data.downloadUrl &&
                        data.job.status === 'COMPLETED' &&
                        data.job.verificationStatus === 'PASSED';

                      return (
                        <div className="job-item" key={jobId}>
                          <div className="job-icon">
                            {renderStatusIcon(data.job.status, data.job.verificationStatus)}
                          </div>
                          <div className="job-info">
                            <div className="job-name">{displayName}</div>
                            <div className="job-meta">
                              <span className={`status-badge ${getStatusVariant(data.job.status)}`}>
                                {data.job.status}
                              </span>
                              <span className="job-message">
                                {getStatusMessage(data.job)}
                              </span>
                            </div>
                          </div>
                          {canDownload && (
                            <a
                              className="btn btn-outline"
                              href={data.downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              download={displayName}
                            >
                              <Download size={14} />
                              Download
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
