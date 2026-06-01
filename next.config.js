const createNextIntlPlugin = require('next-intl/plugin');
const { withSentryConfig } = require('@sentry/nextjs');

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// Security headers applied to every response. frame-ancestors blocks
// clickjacking without restricting resources we embed (Stripe/Clerk child
// iframes are unaffected). HSTS only takes effect over HTTPS.
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Required on Next 14 so instrumentation.ts / sentry configs are loaded.
  experimental: { instrumentationHook: true },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      // Pinned to the actual upload bucket host (was *.amazonaws.com, any account).
      { protocol: 'https', hostname: 'infoatuvera.s3.us-east-1.amazonaws.com' },
    ],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = withSentryConfig(withNextIntl(nextConfig), {
  // Build-time options. Source maps upload only runs when SENTRY_AUTH_TOKEN is
  // set; otherwise the build proceeds normally without uploading.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
