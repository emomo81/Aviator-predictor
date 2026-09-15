/** @type {import('next').NextConfig} */
const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:4000';

const nextConfig = {
  allowedDevOrigins: ['*'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_BASE_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default nextConfig;
