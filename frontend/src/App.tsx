import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  FormControl,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import {
  CloudUpload,
  Description,
  Download,
  CheckCircle,
  Error as ErrorIcon,
  Pending,
  Translate,
} from '@mui/icons-material';
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

  const getStatusColor = useCallback((status: string) => {
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

  const getStatusIcon = useCallback((status: string, verificationStatus?: string) => {
    if (status === 'COMPLETED' && verificationStatus === 'PASSED') return <CheckCircle color="success" />;
    if (status === 'FAILED' || verificationStatus === 'FAILED') return <ErrorIcon color="error" />;
    if (['IN_PROGRESS', 'VERIFYING', 'UPLOADING', 'QUEUED'].includes(status)) return <CircularProgress size={20} />;
    return <Pending color="disabled" />;
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
    [clearTimer, setError],
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
  }, [computeDisplayName, readyDownloads, setError]);

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

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.100', py: 4 }}>
      <Container maxWidth="md">
        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Stack direction="row" spacing={1} justifyContent="center" alignItems="center" sx={{ mb: 1 }}>
            <Translate sx={{ fontSize: 40, color: 'primary.main' }} />
            <Typography variant="h4" component="h1" fontWeight="bold">
              TIMS Document Translate
            </Typography>
          </Stack>
          <Typography variant="body1" color="text.secondary">
            Securely translate internal documents with automatic language detection and verification
          </Typography>
        </Box>

        {/* Upload Card */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Upload Documents
            </Typography>

            {/* Dropzone */}
            <Paper
              {...getRootProps()}
              sx={{
                p: 4,
                mb: 3,
                border: '2px dashed',
                borderColor: isDragActive ? 'primary.main' : 'grey.300',
                bgcolor: isDragActive ? 'primary.50' : 'grey.50',
                cursor: 'pointer',
                transition: 'all 0.2s',
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor: 'primary.50',
                },
              }}
            >
              <input {...getInputProps()} />
              <Box sx={{ textAlign: 'center' }}>
                <CloudUpload sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
                {selectedFiles.length ? (
                  <>
                    <Typography variant="body1" fontWeight="medium">
                      {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} selected
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={1}
                      flexWrap="wrap"
                      justifyContent="center"
                      sx={{ mt: 1, gap: 1 }}
                    >
                      {selectedFiles.slice(0, 5).map((file) => (
                        <Chip
                          key={`${file.name}-${file.lastModified}`}
                          icon={<Description />}
                          label={file.name}
                          size="small"
                          variant="outlined"
                        />
                      ))}
                      {selectedFiles.length > 5 && (
                        <Chip label={`+${selectedFiles.length - 5} more`} size="small" />
                      )}
                    </Stack>
                  </>
                ) : (
                  <>
                    <Typography variant="body1">
                      Drag & drop files here, or click to select
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Supports .txt, .md, .json, .docx, .pdf (max 5MB each)
                    </Typography>
                  </>
                )}
              </Box>
            </Paper>

            {/* Options */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
              <FormControl fullWidth>
                <InputLabel>Target Language</InputLabel>
                <Select
                  value={targetLanguage}
                  label="Target Language"
                  onChange={(e) => setTargetLanguage(e.target.value)}
                >
                  {LANGUAGES.map((lang) => (
                    <MenuItem key={lang.code} value={lang.code}>
                      {lang.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>Output Format</InputLabel>
                <Select
                  value={targetFormat}
                  label="Output Format"
                  onChange={(e) => setTargetFormat(e.target.value as 'docx' | 'xml')}
                >
                  {FORMATS.map((format) => (
                    <MenuItem key={format.code} value={format.code}>
                      {format.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            {/* Upload Button */}
            <Button
              variant="contained"
              size="large"
              fullWidth
              disabled={disabled}
              onClick={handleUpload}
              startIcon={isUploading ? <CircularProgress size={20} color="inherit" /> : <CloudUpload />}
            >
              {isUploading ? 'Uploading...' : 'Start Translation'}
            </Button>

            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Status Card */}
        <Card>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="h6">Translation Status</Typography>
              {readyDownloads.length > 0 && (
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<Download />}
                  onClick={downloadAllReady}
                >
                  Download All ({readyDownloads.length})
                </Button>
              )}
            </Stack>

            {hasActiveJobs && <LinearProgress sx={{ mb: 2 }} />}

            {!jobEntries.length ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Pending sx={{ fontSize: 48, color: 'grey.400', mb: 1 }} />
                <Typography color="text.secondary">No translations yet</Typography>
              </Box>
            ) : (
              <List disablePadding>
                {jobEntries.map(([jobId, data]) => {
                  const displayName = computeDisplayName(data);
                  const canDownload =
                    data.downloadUrl &&
                    data.job.status === 'COMPLETED' &&
                    data.job.verificationStatus === 'PASSED';

                  return (
                    <ListItem
                      key={jobId}
                      divider
                      secondaryAction={
                        canDownload && (
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<Download />}
                            href={data.downloadUrl}
                            target="_blank"
                            download={displayName}
                          >
                            Download
                          </Button>
                        )
                      }
                    >
                      <ListItemIcon>
                        {getStatusIcon(data.job.status, data.job.verificationStatus)}
                      </ListItemIcon>
                      <ListItemText
                        primary={displayName}
                        secondary={
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Chip
                              label={data.job.status}
                              size="small"
                              color={getStatusColor(data.job.status) as any}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {getStatusMessage(data.job)}
                            </Typography>
                          </Stack>
                        }
                      />
                    </ListItem>
                  );
                })}
              </List>
            )}
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}

export default App;
