// Central API base URL.
//
// Production (Bluehost): the Node process serves this React build and the API
// from the same domain, so the base is empty and every call goes out as a
// relative path like /api/books. Nothing to configure, and no CORS — and it
// keeps working if the domain changes, with no rebuild.
//
// Local development: the frontend runs on Vite's port and the backend on
// 5000, so it needs the absolute address.
//
// Override either by setting VITE_API_URL — including to an empty string,
// which is what front-end/.env.production does.
const configured = import.meta.env.VITE_API_URL;

export const API = (
  configured !== undefined && configured !== null
    ? configured
    : (import.meta.env.PROD ? '' : 'http://localhost:5000')
).replace(/\/+$/, '');
