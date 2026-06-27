import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this folder — without this, Turbopack walks up
  // parent directories and can mistakenly pick an unrelated lockfile (e.g. one
  // in the user's home directory) as the project root
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
