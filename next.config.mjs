/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Dev-only: let the Next dev server serve its /_next/* assets (CSS/JS) to requests
  // coming through the ngrok tunnel host. Without this, opening the app via the ngrok
  // URL renders unstyled HTML because Next blocks cross-origin internal asset requests.
  // No effect on production builds. Add your exact ngrok host if a wildcard doesn't match.
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok.app", "*.ngrok.io", "*.ngrok-free.dev"],
};

export default nextConfig;
