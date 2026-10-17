import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const nextCli = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const child = spawn(process.execPath, [nextCli, 'build'], {
  env: { ...process.env, TAURI_BUILD: '1' },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('Failed to start the static desktop build.', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`The static desktop build was terminated by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
