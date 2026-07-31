/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow large file uploads (50MB max)
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
  // Vercel serverless function timeout (Pro plan: 60s)
  serverRuntimeConfig: {
    maxDuration: 300,
  },
};

module.exports = nextConfig;
