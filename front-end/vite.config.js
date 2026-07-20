import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config replacing Create React App (react-scripts).
// - Dev server stays on port 3000, same as CRA, so nothing else changes.
// - This project writes JSX inside .js files (CRA allowed that), so both
//   the transform pipeline and dependency pre-bundling treat .js as JSX.
// - Production build still outputs to "build/" like CRA did.
export default defineConfig({
  plugins: [react()],
  server: {
    open: true, // default Vite port: 5173
  },
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.jsx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },
  build: {
    outDir: 'dist', // Vercel's expected default output folder
  },
});
