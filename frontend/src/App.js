import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { fetchStatus, requestUploadUrl } from './api';
const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'ja', label: 'Japanese' },
];
const POLL_INTERVAL = 3000;
function App() {
    const [selectedFile, setSelectedFile] = useState(null);
    const [targetLanguage, setTargetLanguage] = useState('en');
    const [jobId, setJobId] = useState('');
    const [job, setJob] = useState(null);
    const [downloadUrl, setDownloadUrl] = useState('');
    const [error, setError] = useState('');
    const [isUploading, setUploading] = useState(false);
    const [isPolling, setPolling] = useState(false);
    const onDrop = useCallback((acceptedFiles) => {
        if (acceptedFiles?.length) {
            setSelectedFile(acceptedFiles[0]);
            setJob(null);
            setJobId('');
            setDownloadUrl('');
        }
    }, []);
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        multiple: false,
        maxSize: 5 * 1024 * 1024,
        accept: {
            'text/plain': ['.txt'],
            'text/markdown': ['.md'],
            'application/json': ['.json'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            'application/pdf': ['.pdf'],
        },
    });
    const disabled = !selectedFile || isUploading;
    const statusMessage = useMemo(() => {
        if (!job)
            return 'Waiting to start translation…';
        if (job.status === 'FAILED')
            return job.errorMessage ?? 'Translation failed';
        if (job.status === 'VERIFYING')
            return 'Checking translated file before release…';
        if (job.status === 'COMPLETED') {
            return job.verificationDetails
                ? `Translation ready (${job.verificationDetails})`
                : 'Translation ready';
        }
        return `Current status: ${job.status}`;
    }, [job]);
    useEffect(() => {
        if (!jobId)
            return;
        let active = true;
        setPolling(true);
        const run = async () => {
            try {
                const result = await fetchStatus(jobId);
                if (!active)
                    return;
                setJob(result.job);
                setDownloadUrl(result.downloadUrl ?? '');
                if (['COMPLETED', 'FAILED'].includes(result.job.status)) {
                    setPolling(false);
                    return;
                }
            }
            catch (err) {
                console.error(err);
                setError('Failed to fetch status');
            }
            if (active) {
                setTimeout(run, POLL_INTERVAL);
            }
        };
        run();
        return () => {
            active = false;
            setPolling(false);
        };
    }, [jobId]);
    const handleUpload = async () => {
        if (!selectedFile) {
            setError('Please select a file first');
            return;
        }
        setError('');
        setUploading(true);
        try {
            const extension = selectedFile.name.split('.').pop();
            const { jobId: newJobId, upload } = await requestUploadUrl({
                fileName: selectedFile.name,
                targetLanguage,
                contentType: selectedFile.type || 'text/plain',
            });
            const formData = new FormData();
            Object.entries(upload.fields).forEach(([key, value]) => {
                formData.append(key, value);
            });
            formData.append('file', selectedFile);
            const response = await fetch(upload.url, {
                method: 'POST',
                body: formData,
            });
            if (!response.ok) {
                throw new Error('Upload to S3 failed');
            }
            setJobId(newJobId);
            setJob({
                jobId: newJobId,
                fileName: selectedFile.name,
                sourceLanguage: 'auto',
                targetLanguage,
                status: 'UPLOADING',
                inputKey: upload.fields.key,
                contentType: selectedFile.type,
                fileExtension: extension?.toLowerCase(),
                verificationStatus: 'PENDING',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
        }
        catch (err) {
            console.error(err);
            setError('Unable to start upload. Check logs and API URL.');
        }
        finally {
            setUploading(false);
        }
    };
    return (_jsxs("div", { className: "page", children: [_jsxs("header", { children: [_jsx("h1", { children: "TIMS Document Translate" }), _jsx("p", { children: "Securely submit internal documents, choose the destination language, and receive a reviewed translation ready for clients." })] }), _jsxs("section", { className: "card", children: [_jsxs("div", { className: `dropzone ${isDragActive ? 'active' : ''}`, ...getRootProps(), children: [_jsx("input", { ...getInputProps() }), selectedFile ? (_jsxs("p", { children: ["Selected: ", _jsx("strong", { children: selectedFile.name })] })) : (_jsx("p", { children: "Drag & drop a .txt/.md/.json/.docx/.pdf file here, or click to select" }))] }), _jsxs("label", { className: "language-picker", children: ["Target language", _jsx("select", { value: targetLanguage, onChange: (e) => setTargetLanguage(e.target.value), children: LANGUAGES.map((language) => (_jsx("option", { value: language.code, children: language.label }, language.code))) })] }), _jsx("button", { className: "primary", onClick: handleUpload, disabled: disabled, children: isUploading ? 'Uploading…' : 'Start translation' }), error && _jsx("p", { className: "error", children: error })] }), _jsxs("section", { className: "card", children: [_jsx("h2", { children: "Status" }), _jsx("p", { children: job ? statusMessage : 'No active job yet.' }), isPolling && _jsx("p", { className: "muted", children: "Polling AWS for updates\u2026" }), downloadUrl && job?.status === 'COMPLETED' && job.verificationStatus === 'PASSED' && (_jsx("a", { href: downloadUrl, className: "primary", target: "_blank", rel: "noreferrer", children: "Download translated file" }))] })] }));
}
export default App;
