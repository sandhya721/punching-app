'use strict';

require('dotenv').config();

const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const path     = require('path');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ── MongoDB Connection ────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('ERROR: MONGO_URI is not set in .env file');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('MongoDB connected successfully'))
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });

// ── Schema ────────────────────────────────────────────────────────────────────
const punchSchema = new mongoose.Schema(
  {
    employeeId:   { type: String, required: true, trim: true },
    employeeName: { type: String, required: true, trim: true },
    punchIn:      { type: Date, default: null },
    punchOut:     { type: Date, default: null },
    date:         { type: String, required: true }
  },
  { timestamps: true }
);

const Punch = mongoose.model('Punch', punchSchema);

// ── Helpers ───────────────────────────────────────────────────────────────────
function getToday() {
  return new Date().toISOString().split('T')[0];
}

function calcDuration(punchIn, punchOut) {
  const diffMs  = new Date(punchOut) - new Date(punchIn);
  const hours   = Math.floor(diffMs / 1000 / 3600);
  const minutes = Math.floor((diffMs / 1000 % 3600) / 60);
  return hours + 'h ' + minutes + 'm';
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/punch-in
app.post('/api/punch-in', async function (req, res) {
  try {
    const employeeId   = req.body.employeeId   ? req.body.employeeId.trim()   : '';
    const employeeName = req.body.employeeName ? req.body.employeeName.trim() : '';

    if (!employeeId || !employeeName) {
      return res.status(400).json({ error: 'employeeId and employeeName are required.' });
    }

    const today    = getToday();
    const existing = await Punch.findOne({ employeeId: employeeId, date: today, punchOut: null });

    if (existing) {
      return res.status(400).json({ error: 'Already punched in today. Please punch out first.' });
    }

    const record = await Punch.create({
      employeeId:   employeeId,
      employeeName: employeeName,
      punchIn:      new Date(),
      date:         today
    });

    return res.status(201).json({ message: 'Punched In successfully!', record: record });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/punch-out
app.post('/api/punch-out', async function (req, res) {
  try {
    const employeeId = req.body.employeeId ? req.body.employeeId.trim() : '';

    if (!employeeId) {
      return res.status(400).json({ error: 'employeeId is required.' });
    }

    const today  = getToday();
    const record = await Punch.findOne({ employeeId: employeeId, date: today, punchOut: null });

    if (!record) {
      return res.status(404).json({ error: 'No active punch-in found for today.' });
    }

    record.punchOut = new Date();
    await record.save();

    const duration = calcDuration(record.punchIn, record.punchOut);
    return res.json({ message: 'Punched Out! Total time: ' + duration, record: record });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/records
app.get('/api/records', async function (req, res) {
  try {
    const filter = {};
    if (req.query.employeeId) filter.employeeId = req.query.employeeId.trim();
    if (req.query.date)       filter.date       = req.query.date;

    const records  = await Punch.find(filter).sort({ punchIn: -1 });
    const enriched = records.map(function (r) {
      const obj      = r.toObject();
      obj.duration   = (r.punchIn && r.punchOut) ? calcDuration(r.punchIn, r.punchOut) : 'In Progress';
      return obj;
    });

    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/status/:employeeId
app.get('/api/status/:employeeId', async function (req, res) {
  try {
    const today  = getToday();
    const active = await Punch.findOne({
      employeeId: req.params.employeeId.trim(),
      date:       today,
      punchOut:   null
    });
    return res.json({ isPunchedIn: !!active, record: active || null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/summary
app.get('/api/summary', async function (req, res) {
  try {
    const date    = req.query.date || getToday();
    const records = await Punch.find({ date: date }).sort({ employeeId: 1 });

    const summary = records.map(function (r) {
      return {
        employeeId:   r.employeeId,
        employeeName: r.employeeName,
        punchIn:      r.punchIn,
        punchOut:     r.punchOut,
        duration:     (r.punchIn && r.punchOut) ? calcDuration(r.punchIn, r.punchOut) : 'In Progress',
        status:       r.punchOut ? 'Completed' : 'Active'
      };
    });

    return res.json({ date: date, total: summary.length, summary: summary });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/records/:id
app.delete('/api/records/:id', async function (req, res) {
  try {
    await Punch.findByIdAndDelete(req.params.id);
    return res.json({ message: 'Record deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Serve frontend
app.get('*', function (req, res) {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log('Server running on port ' + PORT);
});
