import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import healthRouter from './routes/health.js';
import whatsappRouter from './routes/whatsapp.js';
import orgsRouter from './routes/orgs.js';

const app = express();

// CORS
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',') }));
app.use(express.json({ limit: '2mb' }));

// Routes
app.use('/health', healthRouter);
app.use('/whatsapp', whatsappRouter);
app.use('/orgs', orgsRouter);

// Static + fallback
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.join(__dirname, '../public');
app.use(express.static(staticDir));
app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`[wizbi-cp] listening on :${port}`));
