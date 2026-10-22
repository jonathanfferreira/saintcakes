import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Hosted builds must use shared storage, never silently publish a browser-only demo.
  if (process.env.VERCEL === '1') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const url = env.VITE_SUPABASE_URL;
    const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !/^https:\/\//.test(url) || !key || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      throw new Error('Configure VITE_SUPABASE_URL (HTTPS) and VITE_SUPABASE_PUBLISHABLE_KEY in Vercel before deploying.');
    }
  }
  return { plugins: [react()] };
});
