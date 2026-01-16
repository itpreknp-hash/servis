/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // PAŽNJA: Ovo dozvoljava build čak i ako postoje TypeScript greške
    ignoreBuildErrors: true,
  },
  eslint: {
    // Ovo ignoriše ESLint greške tokom build-a
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;