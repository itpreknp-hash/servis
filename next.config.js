/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // !! OPREZ - ovo preskače type checking u produkciji !!
    ignoreBuildErrors: true,
  },
};

export default nextConfig;