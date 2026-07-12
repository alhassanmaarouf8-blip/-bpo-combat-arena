const pageOrigin = typeof window !== 'undefined' ? window.location.origin : '';
export const WS_URL = typeof __WS_URL__ !== 'undefined' ? __WS_URL__ : pageOrigin.replace(/^http/, 'ws');
export const API_URL = typeof __API_URL__ !== 'undefined' ? __API_URL__ : pageOrigin;
export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
export const IS_PRODUCTION = import.meta.env.PROD;
export const INTERNAL_TOOLS_ENABLED = !IS_PRODUCTION || import.meta.env.VITE_ENABLE_INTERNAL_TOOLS === '1';
