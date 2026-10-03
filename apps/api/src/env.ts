// Imported first by main.ts so apps/api/.env is loaded before any module reads process.env.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const envFile = join(__dirname, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
