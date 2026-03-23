// ─────────────────────────────────────────────────────────────────────────────
// server.js  —  Punching App with Couchbase Cloud (Capella) + S3 presigned URL
//               Deployed on Render + Private EC2 behind AWS Application Load Balancer
// ─────────────────────────────────────────────────────────────────────────────
//
// INSTALL DEPENDENCIES:
//   npm install express cors dotenv couchbase @aws-sdk/client-s3 @aws-sdk/s3-request-presigner uuid
//
// .env variables needed:
//   CB_CONNECTION_STRING   — e.g. couchbases://cb.xxxxxx.cloud.couchbase.com
//   CB_USERNAME            — your Couchbase database user
//   CB_PASSWORD            — your Couchbase database password
//   CB_BUCKET_NAME         — e.g. punching-app
//   CB_SCOPE_NAME          — _default  (or your custom scope)
//   CB_COLLECTION_NAME     — attendance (or your collection name)
//   AWS_REGION             — eu-north-1
//   AWS_ACCESS_KEY_ID      — your AWS key
//   AWS_SECRET_ACCESS_KEY  — your AWS secret
//   S3_BUCKET_NAME         — punchin-screenshots-bucket
//   PORT                   — 3000
//   RENDER_APP_URL         — https://your-app.onrender.com
//   ALB_DNS_NAME           — my-load-balancer-742843387.eu-north-1.elb.amazonaws.com
// ─────────────────────────────────────────────────────────────────────────────

// ✅ Load environment variables FIRST before anything else
require('dotenv').config();

const express        = require('express');
const cors           = require('cors');
const path           = require('path');
const { v4: uuidv4 } = require('uuid');

// AWS S3
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl }               = require('@aws-sdk/s3-request-presigner');

// Couchbase
const couchbase = require('couchbase');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────────────────────
// ✅ ALB CONFIG 1: Trust Proxy
// Tells Express to trust X-Forwarded-For / X-Forwarded-Proto headers from ALB
// so req.ip shows the real client IP instead of the ALB's internal IP.
// ─────────────────────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ── AWS S3 client ─────────────────────────────────────────────────────────────
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET     = process.env.S3_BUCKET_NAME;
const AWS_REGION = process.env.AWS_REGION;

// ─────────────────────────────────────────────────────────────────────────────
// ✅ ALB CONFIG 2: CORS
// Whitelists Render frontend, ALB DNS, and localhost.
// Also allows all *.onrender.com subdomains for Render preview deployments.
// ─────────────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.RENDER_APP_URL,             // e.g. https://punching-app.onrender.com
  `http://${process.env.ALB_DNS_NAME}`,   // ALB HTTP
  `https://${process.env.ALB_DNS_NAME}`,  // ALB HTTPS (if SSL cert attached)
  'http://localhost:3000',                // local dev
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (curl, Postman, mobile apps)
    if (!origin) return callback(null, true);

    // Allow all Render deployment URLs (*.onrender.com)
    if (origin.endsWith('.onrender.com')) return callback(null, true);

    // Allow if origin is in the whitelist
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);

    // Allow if origin contains the ALB DNS (handles http/https variants)
    if (process.env.ALB_DNS_NAME && origin.includes(process.env.ALB_DNS_NAME)) {
      return callback(null, true);
    }

    console.warn(`[CORS] Blocked: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// ─────────────────────────────────────────────────────────────────────────────
// Couchbase state — populated once connectCouchbase() resolves
// ─────────────────────────────────────────────────────────────────────────────
let collection;
let clusterInstance;

async function connectCouchbase() {
  clusterInstance = await couchbase.connect(process.env.CB_CONNECTION_STRING, {
    username:      process.env.CB_USERNAME,
    password:      process.env.CB_PASSWORD,
    configProfile: 'wanDevelopment',
  });
  const bucket = clusterInstance.bucket(process.env.CB_BUCKET_NAME);
  const scope  = bucket.scope(process.env.CB_SCOPE_NAME || '_default');
  collection   = scope.collection(process.env.CB_COLLECTION_NAME || 'attendance');
  console.log('✅ Connected to Couchbase Capella');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().split('T')[0];

function calcDuration(punchIn, punchOut) {
  const ms   = new Date(punchOut) - new Date(punchIn);
  const mins = Math.floor(ms / 60000);
  const h    = Math.floor(mins / 60);
  const m    = mins % 60;
  return `${h}h ${m < 10 ? '0' + m : m}m`;
}

async function runQuery(query, parameters) {
  return clusterInstance.query(query, { parameters });
}

// ─────────────────────────────────────────────────────────────────────────────
// ✅ RENDER FIX: Guard middleware — must be BEFORE all /api routes
//
// If Couchbase hasn't connected yet, return 503 instead of crashing.
// This keeps the app alive on Render while the DB is still connecting.
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api', (req, res, next) => {
  if (!clusterInstance || !collection) {
    return res.status(503).json({
      error: 'Server is starting up, database not ready yet. Please retry in a few seconds.'
    });
  }
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// ✅ ALB CONFIG 3: Health Check Endpoint   GET /health
//
// ALB pings this route every 30s. Must return 200 or instance is marked unhealthy.
// Configure in AWS Console → EC2 → Target Groups → Health checks:
//   Path            → /health
//   Protocol        → HTTP
//   Port            → 3000
//   Healthy codes   → 200
//   Interval        → 30s
//   Timeout         → 5s
//   Healthy thresh  → 2
//   Unhealthy thresh→ 3
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status:   'ok',
    uptime:   `${Math.floor(process.uptime())}s`,
    database: clusterInstance && collection ? 'connected' : 'connecting...',
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: POST /api/s3-presigned-url
// Returns a short-lived presigned PUT URL + permanent S3 file URL
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/s3-presigned-url', async (req, res) => {
  const { fileName, fileType } = req.body;
  if (!fileName || !fileType) {
    return res.status(400).json({ error: 'fileName and fileType are required.' });
  }
  try {
    const command = new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         fileName,
      ContentType: fileType,
    });
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    const fileUrl      = `https://${BUCKET}.s3.${AWS_REGION}.amazonaws.com/${fileName}`;
    res.json({ presignedUrl, fileUrl });
  } catch (err) {
    console.error('Presigned URL error:', err);
    res.status(500).json({ error: 'Could not generate upload URL.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: POST /api/punch-in
// Body: { employeeId, employeeName, photoUrl? }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/punch-in', async (req, res) => {
  const { employeeId, employeeName, photoUrl } = req.body;
  if (!employeeId || !employeeName) {
    return res.status(400).json({ error: 'employeeId and employeeName are required.' });
  }
  try {
    const checkQuery = `
      SELECT META().id
      FROM \`${process.env.CB_BUCKET_NAME}\`.\`${process.env.CB_SCOPE_NAME || '_default'}\`.\`${process.env.CB_COLLECTION_NAME || 'attendance'}\`
      WHERE employeeId = $employeeId
        AND date       = $date
        AND punchOut   IS MISSING
      LIMIT 1
    `;
    const checkResult = await runQuery(checkQuery, { employeeId, date: today() });
    if (checkResult.rows && checkResult.rows.length > 0) {
      return res.status(400).json({ error: 'Already punched in today.' });
    }
    const docId  = `attendance::${employeeId}::${Date.now()}`;
    const record = {
      type:        'attendance',
      employeeId,
      employeeName,
      date:        today(),
      punchIn:     new Date().toISOString(),
      punchOut:    null,
      duration:    null,
      photoUrl:    photoUrl || null,
    };
    await collection.insert(docId, record);
    console.log(`[PUNCH IN]  ${employeeName} (${employeeId})  photo: ${photoUrl || 'none'}`);
    res.json({ message: `Punched in successfully.${photoUrl ? ' Photo saved to S3.' : ''}` });
  } catch (err) {
    console.error('Punch-in error:', err);
    res.status(500).json({ error: 'Server error during punch-in.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: POST /api/punch-out
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/punch-out', async (req, res) => {
  const { employeeId } = req.body;
  if (!employeeId) return res.status(400).json({ error: 'employeeId is required.' });
  try {
    const query = `
      SELECT META().id AS docId, *
      FROM \`${process.env.CB_BUCKET_NAME}\`.\`${process.env.CB_SCOPE_NAME || '_default'}\`.\`${process.env.CB_COLLECTION_NAME || 'attendance'}\`
      WHERE employeeId = $employeeId
        AND date       = $date
        AND punchOut   IS MISSING
      LIMIT 1
    `;
    const result = await runQuery(query, { employeeId, date: today() });
    if (!result.rows || result.rows.length === 0) {
      return res.status(400).json({ error: 'No active punch-in found for today.' });
    }
    const row      = result.rows[0];
    const docId    = row.docId;
    const record   = row[process.env.CB_COLLECTION_NAME || 'attendance'];
    const punchOut = new Date().toISOString();
    const duration = calcDuration(record.punchIn, punchOut);
    await collection.mutateIn(docId, [
      couchbase.MutateInSpec.upsert('punchOut', punchOut),
      couchbase.MutateInSpec.upsert('duration', duration),
    ]);
    console.log(`[PUNCH OUT] ${record.employeeName} (${employeeId})  duration: ${duration}`);
    res.json({ message: `Punched out successfully. Duration: ${duration}` });
  } catch (err) {
    console.error('Punch-out error:', err);
    res.status(500).json({ error: 'Server error during punch-out.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: GET /api/status/:employeeId
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/status/:employeeId', async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM \`${process.env.CB_BUCKET_NAME}\`.\`${process.env.CB_SCOPE_NAME || '_default'}\`.\`${process.env.CB_COLLECTION_NAME || 'attendance'}\`
      WHERE employeeId = $employeeId
        AND date       = $date
        AND punchOut   IS MISSING
      LIMIT 1
    `;
    const result = await runQuery(query, { employeeId: req.params.employeeId, date: today() });
    const record = result.rows.length > 0
      ? result.rows[0][process.env.CB_COLLECTION_NAME || 'attendance']
      : null;
    res.json({ isPunchedIn: !!record, record });
  } catch (err) {
    console.error('Status error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: GET /api/records
// Optional: ?employeeId=EMP001  OR  ?date=2024-03-18
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/records', async (req, res) => {
  try {
    let whereClause = 'type = "attendance"';
    const params    = {};
    if (req.query.employeeId) {
      whereClause += ' AND employeeId = $employeeId';
      params.employeeId = req.query.employeeId;
    }
    if (req.query.date) {
      whereClause += ' AND date = $date';
      params.date = req.query.date;
    }
    const query = `
      SELECT *
      FROM \`${process.env.CB_BUCKET_NAME}\`.\`${process.env.CB_SCOPE_NAME || '_default'}\`.\`${process.env.CB_COLLECTION_NAME || 'attendance'}\`
      WHERE ${whereClause}
      ORDER BY punchIn DESC
    `;
    const result  = await runQuery(query, params);
    const records = result.rows.map(r => r[process.env.CB_COLLECTION_NAME || 'attendance']);
    res.json(records);
  } catch (err) {
    console.error('Records error:', err);
    res.status(500).json({ error: 'Server error fetching records.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: GET /api/summary
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/summary', async (req, res) => {
  try {
    const query = `
      SELECT employeeId, employeeName, punchOut
      FROM \`${process.env.CB_BUCKET_NAME}\`.\`${process.env.CB_SCOPE_NAME || '_default'}\`.\`${process.env.CB_COLLECTION_NAME || 'attendance'}\`
      WHERE type = "attendance"
        AND date = $date
    `;
    const result  = await runQuery(query, { date: today() });
    const summary = result.rows.map(r => ({
      employeeId:   r.employeeId,
      employeeName: r.employeeName,
      status:       r.punchOut ? 'Completed' : 'Active',
    }));
    res.json({ total: summary.length, summary });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Server error fetching summary.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ✅ RENDER FIX + ALB CONFIG 4: Listen on 0.0.0.0 FIRST, connect DB after
//
// OLD (broken) approach:
//   connectCouchbase().then(() => app.listen(...))
//   → If DB is slow, Render times out waiting for a port → deploy fails
//
// NEW (correct) approach:
//   app.listen() immediately  → Render detects port right away ✅
//   connectCouchbase() after  → DB connects in background ✅
//   /api guard middleware     → Returns 503 until DB is ready ✅
//   /health always 200        → ALB health check never fails ✅
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on 0.0.0.0:${PORT}`);
  console.log(`   ALB DNS     : ${process.env.ALB_DNS_NAME   || 'not set'}`);
  console.log(`   Render URL  : ${process.env.RENDER_APP_URL || 'not set'}`);
  console.log(`   Health check: GET /health`);
});

connectCouchbase().catch(err => {
  console.error('❌ Couchbase connection failed:', err.message);
  // Server stays alive — /health still returns 200
  // /api routes return 503 via the guard middleware above
});
