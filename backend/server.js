// ─────────────────────────────────────────────────────────────────────────────
// server.js  —  Punching App with Couchbase Cloud (Capella) + S3 presigned URL
// ─────────────────────────────────────────────────────────────────────────────
//
// INSTALL DEPENDENCIES:
//   npm install express cors dotenv couchbase @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
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
//   S3_BUCKET_NAME         — punchin-screenshots-bucket1
//   PORT                   — 3000
// ─────────────────────────────────────────────────────────────────────────────


const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const { v4: uuidv4 } = require('uuid');

// AWS S3
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl }               = require('@aws-sdk/s3-request-presigner');

// Couchbase
const couchbase = require('couchbase');

const app  = express();
const PORT = process.env.PORT || 3000;

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

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Couchbase connection ───────────────────────────────────────────────────────
let collection; // will be set after connect

async function connectCouchbase() {
  const cluster = await couchbase.connect(process.env.CB_CONNECTION_STRING, {
    username:              process.env.CB_USERNAME,
    password:              process.env.CB_PASSWORD,
    configProfile:         'wanDevelopment', // required for Couchbase Capella cloud
  });

  const bucket     = cluster.bucket(process.env.CB_BUCKET_NAME);
  const scope      = bucket.scope(process.env.CB_SCOPE_NAME     || '_default');
  collection       = scope.collection(process.env.CB_COLLECTION_NAME || 'attendance');

  console.log('✅ Connected to Couchbase Capella');
  return cluster;
}

// ── Helper ────────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().split('T')[0];

function calcDuration(punchIn, punchOut) {
  const ms   = new Date(punchOut) - new Date(punchIn);
  const mins = Math.floor(ms / 60000);
  const h    = Math.floor(mins / 60);
  const m    = mins % 60;
  return `${h}h ${m < 10 ? '0' + m : m}m`;
}

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
// Saves a new attendance record to Couchbase
// Body: { employeeId, employeeName, photoUrl? }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/punch-in', async (req, res) => {
  const { employeeId, employeeName, photoUrl } = req.body;

  if (!employeeId || !employeeName) {
    return res.status(400).json({ error: 'employeeId and employeeName are required.' });
  }

  try {
    // Check: already punched in today?
    const checkQuery = `
      SELECT META().id, *
      FROM \`${process.env.CB_BUCKET_NAME}\`.\`${process.env.CB_SCOPE_NAME || '_default'}\`.\`${process.env.CB_COLLECTION_NAME || 'attendance'}\`
      WHERE employeeId = $employeeId
        AND date       = $date
        AND punchOut   IS MISSING
      LIMIT 1
    `;

    const checkResult = await collection.scope.query
      ? collection.scope.query(checkQuery, { parameters: { employeeId, date: today() } })
      : (await (await couchbase.connect(process.env.CB_CONNECTION_STRING, {
            username: process.env.CB_USERNAME,
            password: process.env.CB_PASSWORD,
            configProfile: 'wanDevelopment',
          })).query(checkQuery, { parameters: { employeeId, date: today() } }));

    if (checkResult.rows && checkResult.rows.length > 0) {
      return res.status(400).json({ error: 'Already punched in today.' });
    }

    // Create new record
    const docId = `attendance::${employeeId}::${Date.now()}`;
    const record = {
      type:         'attendance',
      employeeId,
      employeeName,
      date:         today(),
      punchIn:      new Date().toISOString(),
      punchOut:     null,
      duration:     null,
      photoUrl:     photoUrl || null,
    };

    await collection.insert(docId, record);

    console.log(`[PUNCH IN]  ${employeeName} (${employeeId})  doc: ${docId}  photo: ${photoUrl || 'none'}`);
    res.json({ message: `Punched in successfully.${photoUrl ? ' Photo saved to S3.' : ''}` });

  } catch (err) {
    console.error('Punch-in error:', err);
    res.status(500).json({ error: 'Server error during punch-in.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: POST /api/punch-out
// Finds the active punch-in record and sets punchOut + duration
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/punch-out', async (req, res) => {
  const { employeeId } = req.body;
  if (!employeeId) return res.status(400).json({ error: 'employeeId is required.' });

  try {
    // Find active punch-in (no punchOut) for today
    const query = `
      SELECT META().id AS docId, *
      FROM \`${process.env.CB_BUCKET_NAME}\`.\`${process.env.CB_SCOPE_NAME || '_default'}\`.\`${process.env.CB_COLLECTION_NAME || 'attendance'}\`
      WHERE employeeId = $employeeId
        AND date       = $date
        AND punchOut   IS MISSING
      LIMIT 1
    `;

    const cluster = await couchbase.connect(process.env.CB_CONNECTION_STRING, {
      username: process.env.CB_USERNAME,
      password: process.env.CB_PASSWORD,
      configProfile: 'wanDevelopment',
    });

    const result = await cluster.query(query, {
      parameters: { employeeId, date: today() }
    });

    if (!result.rows || result.rows.length === 0) {
      return res.status(400).json({ error: 'No active punch-in found for today.' });
    }

    const row    = result.rows[0];
    const docId  = row.docId;
    const record = row[process.env.CB_COLLECTION_NAME || 'attendance'];

    const punchOut = new Date().toISOString();
    const duration = calcDuration(record.punchIn, punchOut);

    // Update the document
    await collection.mutateIn(docId, [
      couchbase.MutateInSpec.upsert('punchOut',  punchOut),
      couchbase.MutateInSpec.upsert('duration',  duration),
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
// Returns whether an employee is currently punched in
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/status/:employeeId', async (req, res) => {
  try {
    const cluster = await couchbase.connect(process.env.CB_CONNECTION_STRING, {
      username: process.env.CB_USERNAME,
      password: process.env.CB_PASSWORD,
      configProfile: 'wanDevelopment',
    });

    const query = `
      SELECT *
      FROM \`${process.env.CB_BUCKET_NAME}\`.\`${process.env.CB_SCOPE_NAME || '_default'}\`.\`${process.env.CB_COLLECTION_NAME || 'attendance'}\`
      WHERE employeeId = $employeeId
        AND date       = $date
        AND punchOut   IS MISSING
      LIMIT 1
    `;

    const result = await cluster.query(query, {
      parameters: { employeeId: req.params.employeeId, date: today() }
    });

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
// Optional query params: ?employeeId=EMP001  OR  ?date=2024-03-18
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/records', async (req, res) => {
  try {
    const cluster = await couchbase.connect(process.env.CB_CONNECTION_STRING, {
      username: process.env.CB_USERNAME,
      password: process.env.CB_PASSWORD,
      configProfile: 'wanDevelopment',
    });

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

    const result  = await cluster.query(query, { parameters: params });
    const records = result.rows.map(r => r[process.env.CB_COLLECTION_NAME || 'attendance']);

    res.json(records);

  } catch (err) {
    console.error('Records error:', err);
    res.status(500).json({ error: 'Server error fetching records.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: GET /api/summary
// Returns today's total, active, and completed counts
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/summary', async (req, res) => {
  try {
    const cluster = await couchbase.connect(process.env.CB_CONNECTION_STRING, {
      username: process.env.CB_USERNAME,
      password: process.env.CB_PASSWORD,
      configProfile: 'wanDevelopment',
    });

    const query = `
      SELECT employeeId, employeeName, punchOut
      FROM \`${process.env.CB_BUCKET_NAME}\`.\`${process.env.CB_SCOPE_NAME || '_default'}\`.\`${process.env.CB_COLLECTION_NAME || 'attendance'}\`
      WHERE type = "attendance"
        AND date = $date
    `;

    const result  = await cluster.query(query, { parameters: { date: today() } });
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
// Start server after Couchbase connects
// ─────────────────────────────────────────────────────────────────────────────
connectCouchbase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Punching App running at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Failed to connect to Couchbase:', err);
    process.exit(1);
  });
