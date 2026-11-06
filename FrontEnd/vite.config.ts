/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Tests in ../Tests have no node_modules above them, so point their
// package imports at FrontEnd's node_modules.
const fromNodeModules = (pkg: string) => `${import.meta.dirname}/node_modules/${pkg}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Let Vite read files in the project folder (needed for ../Tests).
  server: { fs: { allow: ['..'] } },
  resolve: {
    alias: ['react', '@testing-library/react', '@testing-library/user-event'].map((pkg) => ({
      find: pkg,
      replacement: fromNodeModules(pkg),
    })),
  },
  test: {
    // Frontend tests live in the project-level Tests folder.
    dir: '../Tests/frontend_tests',
    include: ['**/*.test.tsx'],
    environment: 'jsdom',
  },
})
