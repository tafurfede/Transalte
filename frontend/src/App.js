import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Container, FormControl, InputLabel, LinearProgress, List, ListItem, ListItemIcon, ListItemText, MenuItem, Paper, Select, Stack, Typography, } from '@mui/material';
import { CloudUpload, Description, Download, CheckCircle, Error as ErrorIcon, Pending, Translate, } from '@mui/icons-material';
import { fetchStatus, requestUploadUrl, triggerProcess } from './api';
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
function App() {
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [targetLanguage, setTargetLanguage] = useState('es');
    const [targetFormat, setTargetFormat] = useState('xml');
    const [jobs, setJobs] = useState({});
    const [error, setError] = useState('');
    const [isUploading, setUploading] = useState(false);
    const pollingTimers = useRef({});
    const jobEntries = useMemo(() => Object.entries(jobs), [jobs]);
    const hasActiveJobs = useMemo(() => jobEntries.some(([, data]) => !['COMPLETED', 'FAILED'].includes(data.job.status)), [jobEntries]);
    const readyDownloads = useMemo(() => jobEntries.filter(([, data]) => data.downloadUrl && data.job.status === 'COMPLETED' && data.job.verificationStatus === 'PASSED'), [jobEntries]);
    const getStatusMessage = useCallback((currentJob) => {
        if (!currentJob)
            return 'Waiting to start translation...';
        if (currentJob.status === 'FAILED')
            return currentJob.errorMessage ?? 'Translation failed';
        if (currentJob.status === 'VERIFYING')
            return 'Verifying translated file...';
        if (currentJob.status === 'COMPLETED') {
            return currentJob.verificationDetails
                ? `Ready (${currentJob.verificationDetails})`
                : 'Translation ready';
        }
        return `${currentJob.status}`;
    }, []);
    const getStatusColor = useCallback((status) => {
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
    const getStatusIcon = useCallback((status, verificationStatus) => {
        if (status === 'COMPLETED' && verificationStatus === 'PASSED')
            return _jsx(CheckCircle, { color: "success" });
        if (status === 'FAILED' || verificationStatus === 'FAILED')
            return _jsx(ErrorIcon, { color: "error" });
        if (['IN_PROGRESS', 'VERIFYING', 'UPLOADING', 'QUEUED'].includes(status))
            return _jsx(CircularProgress, { size: 20 });
        return _jsx(Pending, { color: "disabled" });
    }, []);
    const clearTimer = useCallback((jobId) => {
        const existing = pollingTimers.current[jobId];
        if (existing) {
            clearTimeout(existing);
            delete pollingTimers.current[jobId];
        }
    }, []);
    useEffect(() => () => {
        Object.values(pollingTimers.current).forEach((timer) => clearTimeout(timer));
    }, []);
    const computeDisplayName = useCallback((data) => {
        return (data.job.outputKey && data.job.outputKey.split('/').pop()) || data.job.fileName;
    }, []);
    const onDrop = useCallback((acceptedFiles) => {
        if (acceptedFiles?.length) {
            if (acceptedFiles.length > MAX_FILES_PER_BATCH) {
                setError(`Max ${MAX_FILES_PER_BATCH} files per batch. Only first ${MAX_FILES_PER_BATCH} were added.`);
            }
            else {
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
    const pollJobStatus = useCallback((jobId) => {
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
                }
                else {
                    clearTimer(jobId);
                }
            }
            catch (err) {
                console.error(err);
                setError('Failed to fetch job status. Retrying...');
                clearTimer(jobId);
                pollingTimers.current[jobId] = setTimeout(run, POLL_INTERVAL * 2);
            }
        };
        run();
    }, [clearTimer, setError]);
    const downloadAllReady = useCallback(async () => {
        if (!readyDownloads.length)
            return;
        for (const [, data] of readyDownloads) {
            const displayName = computeDisplayName(data);
            try {
                const response = await fetch(data.downloadUrl);
                if (!response.ok)
                    throw new Error('Download failed');
                const blob = await response.blob();
                const objectUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = objectUrl;
                link.download = displayName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(objectUrl);
            }
            catch (err) {
                console.error('Download failed', err);
                setError('Some files could not be downloaded.');
                break;
            }
        }
    }, [computeDisplayName, readyDownloads, setError]);
    const startTranslationForFile = useCallback(async (file) => {
        const extension = file.name.split('.').pop();
        const { jobId: newJobId, upload } = await requestUploadUrl({
            fileName: file.name,
            targetLanguage,
            outputFormat: targetFormat,
            contentType: file.type || 'text/plain',
        });
        const isPostUpload = Boolean(upload.fields?.key);
        let response;
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
        }
        else {
            const headers = {};
            const hintedType = upload.fields?.['Content-Type'] || file.type || 'application/octet-stream';
            if (hintedType)
                headers['Content-Type'] = hintedType;
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
        }
        catch (processError) {
            console.error('Process trigger failed', processError);
        }
        const now = new Date().toISOString();
        const placeholder = {
            jobId: newJobId,
            fileName: file.name,
            sourceLanguage: 'auto',
            targetLanguage,
            outputFormat: targetFormat,
            status: 'UPLOADING',
            inputKey: upload.fields?.key || `raw/${newJobId}/${file.name}`,
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
    }, [pollJobStatus, targetLanguage, targetFormat]);
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
            }
            catch (err) {
                console.error(err);
                encounteredError = true;
            }
        }
        if (encounteredError) {
            setError('Some files could not be uploaded. Check the console.');
        }
        setUploading(false);
    };
    return (_jsx(Box, { sx: { minHeight: '100vh', bgcolor: 'grey.100', py: 4 }, children: _jsxs(Container, { maxWidth: "md", children: [_jsxs(Box, { sx: { textAlign: 'center', mb: 4 }, children: [_jsxs(Stack, { direction: "row", spacing: 1, justifyContent: "center", alignItems: "center", sx: { mb: 1 }, children: [_jsx(Translate, { sx: { fontSize: 40, color: 'primary.main' } }), _jsx(Typography, { variant: "h4", component: "h1", fontWeight: "bold", children: "TIMS Document Translate" })] }), _jsx(Typography, { variant: "body1", color: "text.secondary", children: "Securely translate internal documents with automatic language detection and verification" })] }), _jsx(Card, { sx: { mb: 3 }, children: _jsxs(CardContent, { children: [_jsx(Typography, { variant: "h6", gutterBottom: true, children: "Upload Documents" }), _jsxs(Paper, { ...getRootProps(), sx: {
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
                                }, children: [_jsx("input", { ...getInputProps() }), _jsxs(Box, { sx: { textAlign: 'center' }, children: [_jsx(CloudUpload, { sx: { fontSize: 48, color: 'primary.main', mb: 1 } }), selectedFiles.length ? (_jsxs(_Fragment, { children: [_jsxs(Typography, { variant: "body1", fontWeight: "medium", children: [selectedFiles.length, " file", selectedFiles.length === 1 ? '' : 's', " selected"] }), _jsxs(Stack, { direction: "row", spacing: 1, flexWrap: "wrap", justifyContent: "center", sx: { mt: 1, gap: 1 }, children: [selectedFiles.slice(0, 5).map((file) => (_jsx(Chip, { icon: _jsx(Description, {}), label: file.name, size: "small", variant: "outlined" }, `${file.name}-${file.lastModified}`))), selectedFiles.length > 5 && (_jsx(Chip, { label: `+${selectedFiles.length - 5} more`, size: "small" }))] })] })) : (_jsxs(_Fragment, { children: [_jsx(Typography, { variant: "body1", children: "Drag & drop files here, or click to select" }), _jsx(Typography, { variant: "body2", color: "text.secondary", children: "Supports .txt, .md, .json, .docx, .pdf (max 5MB each)" })] }))] })] }), _jsxs(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 2, sx: { mb: 3 }, children: [_jsxs(FormControl, { fullWidth: true, children: [_jsx(InputLabel, { children: "Target Language" }), _jsx(Select, { value: targetLanguage, label: "Target Language", onChange: (e) => setTargetLanguage(e.target.value), children: LANGUAGES.map((lang) => (_jsx(MenuItem, { value: lang.code, children: lang.label }, lang.code))) })] }), _jsxs(FormControl, { fullWidth: true, children: [_jsx(InputLabel, { children: "Output Format" }), _jsx(Select, { value: targetFormat, label: "Output Format", onChange: (e) => setTargetFormat(e.target.value), children: FORMATS.map((format) => (_jsx(MenuItem, { value: format.code, children: format.label }, format.code))) })] })] }), _jsx(Button, { variant: "contained", size: "large", fullWidth: true, disabled: disabled, onClick: handleUpload, startIcon: isUploading ? _jsx(CircularProgress, { size: 20, color: "inherit" }) : _jsx(CloudUpload, {}), children: isUploading ? 'Uploading...' : 'Start Translation' }), error && (_jsx(Alert, { severity: "error", sx: { mt: 2 }, children: error }))] }) }), _jsx(Card, { children: _jsxs(CardContent, { children: [_jsxs(Stack, { direction: "row", justifyContent: "space-between", alignItems: "center", sx: { mb: 2 }, children: [_jsx(Typography, { variant: "h6", children: "Translation Status" }), readyDownloads.length > 0 && (_jsxs(Button, { variant: "contained", color: "success", startIcon: _jsx(Download, {}), onClick: downloadAllReady, children: ["Download All (", readyDownloads.length, ")"] }))] }), hasActiveJobs && _jsx(LinearProgress, { sx: { mb: 2 } }), !jobEntries.length ? (_jsxs(Box, { sx: { textAlign: 'center', py: 4 }, children: [_jsx(Pending, { sx: { fontSize: 48, color: 'grey.400', mb: 1 } }), _jsx(Typography, { color: "text.secondary", children: "No translations yet" })] })) : (_jsx(List, { disablePadding: true, children: jobEntries.map(([jobId, data]) => {
                                    const displayName = computeDisplayName(data);
                                    const canDownload = data.downloadUrl &&
                                        data.job.status === 'COMPLETED' &&
                                        data.job.verificationStatus === 'PASSED';
                                    return (_jsxs(ListItem, { divider: true, secondaryAction: canDownload && (_jsx(Button, { variant: "outlined", size: "small", startIcon: _jsx(Download, {}), href: data.downloadUrl, target: "_blank", download: displayName, children: "Download" })), children: [_jsx(ListItemIcon, { children: getStatusIcon(data.job.status, data.job.verificationStatus) }), _jsx(ListItemText, { primary: displayName, secondary: _jsxs(Stack, { direction: "row", spacing: 1, alignItems: "center", children: [_jsx(Chip, { label: data.job.status, size: "small", color: getStatusColor(data.job.status) }), _jsx(Typography, { variant: "caption", color: "text.secondary", children: getStatusMessage(data.job) })] }) })] }, jobId));
                                }) }))] }) })] }) }));
}
export default App;
