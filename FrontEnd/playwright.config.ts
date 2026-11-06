import path from 'node:path'
import { defineConfig } from '@playwright/test'

const backendDir = path.join(import.meta.dirname, '../BackEnd')

// End-to-end tests: real Chrome -> real frontend -> real backend -> real Whisper + Claude.
export default defineConfig({
  testDir: '../Tests/frontend_tests',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  workers: 1, // one backend running Whisper, so run tests one at a time
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome', // use the installed Google Chrome
  },
  webServer: [
    {
      // Real backend.
      command: '.venv/bin/uvicorn main:app --port 8000',
      cwd: backendDir,
      url: 'http://localhost:8000/docs',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // Second backend with an invalid Claude key, used to test the cleanup-failure path.
      command: '.venv/bin/uvicorn main:app --port 8001',
      cwd: backendDir,
      url: 'http://localhost:8001/docs',
      env: { ANTHROPIC_API_KEY: 'invalid-key-for-tests' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Real frontend.
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
    },
  ],
})
