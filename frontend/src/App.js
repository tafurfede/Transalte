import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
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
const MAX_FILES_PER_BATCH = 10;
function App() {
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [targetLanguage, setTargetLanguage] = useState('es');
    const [targetFormat, setTargetFormat] = useState('docx');
    const [jobs, setJobs] = useState({});
    const [error, setError] = useState('');
    const [isUploading, setUploading] = useState(false);
    const pollingTimers = useRef({});
    const jobEntries = useMemo(() => Object.entries(jobs), [jobs]);
    const hasActiveJobs = useMemo(() => jobEntries.some(([, data]) => !['COMPLETED', 'FAILED'].includes(data.job.status)), [jobEntries]);
    const getStatusMessage = useCallback((currentJob) => {
        if (!currentJob)
            return 'Waiting to start translation…';
        if (currentJob.status === 'FAILED')
            return currentJob.errorMessage ?? 'Translation failed';
        if (currentJob.status === 'VERIFYING')
            return 'Checking translated file before release…';
        if (currentJob.status === 'COMPLETED') {
            return currentJob.verificationDetails
                ? `Translation ready (${currentJob.verificationDetails})`
                : 'Translation ready';
        }
        return `Current status: ${currentJob.status}`;
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
    const onDrop = useCallback((acceptedFiles) => {
        if (acceptedFiles?.length) {
            if (acceptedFiles.length > MAX_FILES_PER_BATCH) {
                setError(`Select up to ${MAX_FILES_PER_BATCH} files per batch. Only the first ${MAX_FILES_PER_BATCH} were added.`);
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
                setError('Failed to fetch job status. Retrying…');
                clearTimer(jobId);
                pollingTimers.current[jobId] = setTimeout(run, POLL_INTERVAL * 2);
            }
        };
        run();
    }, [clearTimer, setError]);
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
            setError('Some files could not be uploaded. Check the console and API logs.');
        }
        setUploading(false);
    };
    return (_jsxs("div", { className: "page", children: [_jsxs("header", { children: [_jsx("h1", { children: "TIMS Document Translate" }), _jsx("p", { children: "Securely submit internal documents, choose the destination language, and receive a reviewed translation ready for clients." })] }), _jsxs("section", { className: "card", children: [_jsxs("div", { className: `dropzone ${isDragActive ? 'active' : ''}`, ...getRootProps(), children: [_jsx("input", { ...getInputProps() }), selectedFiles.length ? (_jsxs("div", { children: [_jsxs("p", { children: [selectedFiles.length, " file", selectedFiles.length === 1 ? '' : 's', " selected (max ", MAX_FILES_PER_BATCH, " per batch)"] }), _jsx("ul", { className: "file-list", children: selectedFiles.map((file) => (_jsx("li", { children: file.name }, `${file.name}-${file.lastModified}`))) })] })) : (_jsxs("p", { children: ["Drag & drop up to ", MAX_FILES_PER_BATCH, " .txt/.md/.json/.docx/.pdf files, or click to select"] }))] }), _jsxs("label", { className: "language-picker", children: ["Target language", _jsx("select", { value: targetLanguage, onChange: (e) => setTargetLanguage(e.target.value), children: LANGUAGES.map((language) => (_jsx("option", { value: language.code, children: language.label }, language.code))) })] }), _jsxs("label", { className: "language-picker", children: ["Target format", _jsx("select", { value: targetFormat, onChange: (e) => setTargetFormat(e.target.value), children: FORMATS.map((format) => (_jsx("option", { value: format.code, children: format.label }, format.code))) })] }), _jsx("button", { className: "primary", onClick: handleUpload, disabled: disabled, children: isUploading ? 'Uploading…' : 'Start translations' }), error && _jsx("p", { className: "error", children: error })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Status" }), !jobEntries.length && _jsx("p", { children: "No active jobs yet." }), jobEntries.length > 0 && (_jsxs(_Fragment, { children: [hasActiveJobs && _jsx("p", { className: "muted", children: "Polling AWS for updates\u2026" }), _jsx("ul", { className: "job-list", children: jobEntries.map(([jobId, data]) => {
                                    const displayName = (data.job.outputKey && data.job.outputKey.split('/').pop()) || data.job.fileName;
                                    return (_jsxs("li", { className: "job-row", children: [_jsxs("div", { children: [_jsx("strong", { children: displayName }), _jsx("p", { className: "muted", children: getStatusMessage(data.job) }), data.job.status === 'FAILED' && data.job.errorMessage && (_jsx("p", { className: "error", children: data.job.errorMessage }))] }), data.downloadUrl &&
                                                data.job.status === 'COMPLETED' &&
                                                data.job.verificationStatus === 'PASSED' && (_jsx("a", { href: data.downloadUrl, className: "primary", target: "_blank", rel: "noreferrer", download: displayName, children: "Download" }))] }, jobId));
                                }) })] }))] })] }));
}
export default App;
