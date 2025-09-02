import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import healthRouter from './routes/health.js';

const app = express();
app.use(cors());
app.use(express.json());

// routes
app.use('/health', healthRouter);

// static UI (Vanilla)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/', express.static(path.join(__dirname, '../public')));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`[wizbi-cp] listening on :${port}`);
});
