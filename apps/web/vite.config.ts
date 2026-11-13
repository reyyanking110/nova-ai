import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  envDir: '../../',
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
    proxy: { '/api': 'http://127.0.0.1:3001', '/health': 'http://127.0.0.1:3001' },
  },
  build: {
    outDir: 'dist',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules\/(react|react-dom|scheduler)\// },
            { name: 'supabase', test: /node_modules\/@supabase\// },
          ],
        },
      },
    },
  },
});
