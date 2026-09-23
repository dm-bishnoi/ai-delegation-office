import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const { API_PORT } = loadEnv(mode, process.cwd(), 'API_PORT');
  return {
    plugins: [react()],
    server: { proxy: { '/api': `http://127.0.0.1:${API_PORT || '3001'}` } },
  };
});
