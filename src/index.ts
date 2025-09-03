import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import tenantsRouter from './routes/tenants';

// === אתחול Firebase Admin (ADC) ===
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.GCP_PROJECT,
  });
}

const db = admin.firestore();
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

// CORS (אם ניגשים ישר לשירות; דרך Hosting אין צורך)
const ALLOW_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb)=>{
    if(!origin || !ALLOW_ORIGINS.length || ALLOW_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// === Logging קל ===
app.use((req, _res, next)=>{
  (req as any).req_id = Math.random().toString(36).slice(2,10);
  console.log(JSON.stringify({ ts:new Date().toISOString(), req_id:(req as any).req_id, method:req.method, path:req.path }));
  next();
});

// === Health ===
app.get('/health', async (_req, res)=>{
  try{
    const ts = Date.now();
    await db.collection('_health').doc('ping').set({ ts }, { merge:true });
    res.json({ ok:true, ts });
  }catch(e:any){
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// === Routers (קיימים + חדשים) ===
// שומרים על הקיימים אם ישנם בקוד שלך:
try { app.use(require('./routes/orgs').default); } catch {}
try { app.use(require('./routes/factory').default); } catch {}
try { app.use(require('./routes/whatsapp').default); } catch {}
app.use(tenantsRouter);

// === Error handler ===
app.use((err:any, _req:any, res:any, _next:any)=>{
  console.error('Unhandled:', err);
  res.status(500).json({ ok:false, error:String(err) });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=> console.log(`[cp-unified] listening on :${PORT}`));
