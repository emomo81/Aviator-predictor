/** @type {import('next').NextConfig} */
const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:4000';

const nextConfig = {
  // Dev-only origin allowlist. Entries are hostname globs matched by
  // matchWildcardDomain() (NOT regexes), with wildcards only allowed below the
  // registered-domain level - so '*' / '.*' never match. '*.e2b.app' covers the
  // sandbox preview host (https://{port}-{sandboxId}.e2b.app) so /_next/* assets
  // aren't 403'd in the browser preview.
  allowedDevOrigins: ['*.e2b.app'],
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
