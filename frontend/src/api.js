import axios from 'axios';
const api = axios.create({
    baseURL: import.meta.env.VITE_API_BASE || 'http://localhost:3000',
});
export const requestUploadUrl = async (body) => {
    const { data } = await api.post('/upload-url', body);
    return data;
};
export const fetchStatus = async (jobId) => {
    const { data } = await api.get(`/status/${jobId}`);
    return data;
};
