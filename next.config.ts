import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "sportscards.standard.us-east-1.oortstorages.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
