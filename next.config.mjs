import { normalizeApiBase } from './src/lib/apiConfig.mjs';

// Validate during build so an unset variable never ships a localhost API to Vercel.
normalizeApiBase(process.env.NEXT_PUBLIC_API_URL, {
  required: process.env.VERCEL === '1',
  httpsOnly: process.env.VERCEL === '1',
});

export default { poweredByHeader: false };
