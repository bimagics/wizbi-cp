import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import healthRouter from './routes/health.js';

const app = express();

// CORS
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',') }));

app.use(express.json());

// Routes
app.use('/health', healthRouter);

// Static + fallback
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.join(__dirname, '../public');
app.use(express.static(staticDir));

// fallback ל-SPA/סטטי: כל GET אחר יחזיר index.html
app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));

// Start
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`[wizbi-cp] listening on :${port}`);
});
