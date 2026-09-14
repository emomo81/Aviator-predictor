/** @type {import('next').NextConfig} */
const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:4000';

const nextConfig = {
  // The sandbox preview serves this app from a proxied host, so allow any dev origin.
  allowedDevOrigins: ['*'],
  async rewrites() {
    // Server-side proxy: the browser only ever talks to this origin, so relative /api URLs
    // work from the preview host without any CORS or hardcoded localhost in client code.
    return [{ source: '/api/:path*', destination: `${API_BASE_URL}/api/:path*` }];
  },
};

export default nextConfig;
