import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import getDb from './db.js';
import { startScheduler } from './scheduler.js';

import groupRoutes from './routes/api/groupRoutes.js';
import importExportRoutes from './routes/api/importExportRoutes.js';
import statsRoutes from './routes/api/statsRoutes.js';
import urlRoutes from './routes/api/urlRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

app.use('/api', groupRoutes);
app.use('/api', importExportRoutes);
app.use('/api', statsRoutes);
app.use('/api', urlRoutes);

app.listen(PORT, async () => {
  console.log(`后端服务运行在 http://localhost:${PORT}`);
  await getDb();
  startScheduler();
});
