#!/usr/bin/env node
/**
 * Runs the Node API and the Next.js app together with prefixed logs.
 * Kept dependency-free on purpose (no concurrently/nodemon needed).
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const targets = [
  { name: 'api', color: '\x1b[36m', cmd: 'npm', args: ['run', 'dev', '--workspace', 'server'] },
  { name: 'web', color: '\x1b[35m', cmd: 'npm', args: ['run', 'dev', '--workspace', 'web'] },
];

const children = targets.map(({ name, color, cmd, args }) => {
  const child = spawn(cmd, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const write = (buf) => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (line.trim() === '') continue;
      process.stdout.write(`${color}[${name}]\x1b[0m ${line}\n`);
    }
  };
  child.stdout.on('data', write);
  child.stderr.on('data', write);
  child.on('exit', (code) => {
    process.stdout.write(`${color}[${name}]\x1b[0m exited with code ${code}\n`);
    shutdown();
  });
  return child;
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
