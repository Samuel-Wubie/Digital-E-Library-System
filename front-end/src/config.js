// Central API base URL.
// Local development: falls back to the local backend on port 5000.
// Production (Vercel): set the VITE_API_URL environment variable to your
// Railway backend URL, e.g. https://your-backend.up.railway.app
export const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
