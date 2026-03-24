{
  "name": "punch-in-react-app",
  "version": "1.0.0",
  "description": "Punch Clock time tracking app",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "build": "cd client && npm install && npm run build",
    "install-all": "npm install && cd client && npm install"
  },
  "dependencies": {
    "express": "^4.18.2"
  }
}
 
render.yaml
 
const express  = require("express");
const path     = require("path");
const fs       = require("fs");
const http     = require("http");
const https    = require("https");
 
const app = express();
 
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "client/build")));
 
// ── Config from Render environment variables ─────────────────────
// Render Dashboard → Environment → Add these:
//   EC2_PRIVATE_IP  = 13.127.203.140      (Bastion public IP)
//   EC2_PORT        = 5000
//   AWS_REGION      = ap-south-1
//   SNS_TOPIC_ARN   = arn:aws:sns:ap-south-1:XXXXXXXXXXXX:punch-notifications
//   AWS_ACCESS_KEY  = your IAM access key
//   AWS_SECRET_KEY  = your IAM secret key
const EC2_HOST      = process.env.EC2_PRIVATE_IP || "13.127.203.140";
const EC2_PORT      = parseInt(process.env.EC2_PORT || "5000");
const AWS_REGION    = process.env.AWS_REGION     || "ap-south-1";
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN  || "";
const AWS_ACCESS    = process.env.AWS_ACCESS_KEY  || "";
const AWS_SECRET    = process.env.AWS_SECRET_KEY  || "";
 
const DATA_FILE = path.join(__dirname, "entries.json");
 
function loadEntries() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return []; }
}
 
function saveEntries(entries) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2));
}
 
// ── AWS Signature v4 helper (no SDK needed on Render) ────────────
const crypto = require("crypto");
 
function sign(key, msg) {
  return crypto.createHmac("sha256", key).update(msg).digest();
}
function getSignatureKey(secret, date, region, service) {
  const kDate    = sign("AWS4" + secret, date);
  const kRegion  = sign(kDate, region);
  const kService = sign(kRegion, service);
  const kSigning = sign(kService, "aws4_request");
  return kSigning;
}
 
// ── Send SNS notification ─────────────────────────────────────────
async function sendSNSNotification(user, type, timestamp, s3Url) {
  if (!SNS_TOPIC_ARN || !AWS_ACCESS || !AWS_SECRET) {
    console.warn("⚠️  SNS not configured — skipping notification");
    return;
  }
 
  const time      = new Date(timestamp);
  const timeStr   = time.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const icon      = type === "Punch In"    ? "🟢" :
                    type === "Punch Out"   ? "🔴" :
                    type === "Start Break" ? "🟡" : "🔵";
 
  const message = [
    `${icon} PUNCH CLOCK ALERT`,
    `─────────────────────`,
    `Employee : ${user}`,
    `Action   : ${type}`,
    `Time     : ${timeStr} (IST)`,
    s3Url ? `Selfie   : ${s3Url}` : `Selfie   : Not captured`,
    `─────────────────────`,
    `Punch Clock App`,
  ].join("\n");
 
  const subject = `${icon} ${user} — ${type} at ${timeStr}`;
 
  // Build SNS Publish request
  const endpoint  = `https://sns.${AWS_REGION}.amazonaws.com/`;
  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
 
  const params = new URLSearchParams({
    Action:   "Publish",
    TopicArn: SNS_TOPIC_ARN,
    Message:  message,
    Subject:  subject,
    Version:  "2010-03-31",
  });
  const bodyStr = params.toString();
 
  // Canonical request
  const payloadHash     = crypto.createHash("sha256").update(bodyStr).digest("hex");
  const canonicalHeaders = `content-type:application/x-www-form-urlencoded\nhost:sns.${AWS_REGION}.amazonaws.com\nx-amz-date:${amzDate}\n`;
  const signedHeaders    = "content-type;host;x-amz-date";
  const canonicalRequest = [
    "POST", "/", "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
 
  // String to sign
  const credScope   = `${dateStamp}/${AWS_REGION}/sns/aws4_request`;
  const strToSign   = `AWS4-HMAC-SHA256\n${amzDate}\n${credScope}\n` +
    crypto.createHash("sha256").update(canonicalRequest).digest("hex");
 
  // Signature
  const signingKey  = getSignatureKey(AWS_SECRET, dateStamp, AWS_REGION, "sns");
  const signature   = crypto.createHmac("sha256", signingKey).update(strToSign).digest("hex");
  const authHeader  = `AWS4-HMAC-SHA256 Credential=${AWS_ACCESS}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
 
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: `sns.${AWS_REGION}.amazonaws.com`,
      path:     "/",
      method:   "POST",
      headers:  {
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(bodyStr),
        "X-Amz-Date":     amzDate,
        "Authorization":  authHeader,
      },
    };
 
    const req = https.request(reqOptions, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        if (res.statusCode === 200) {
          console.log("✅ SNS notification sent:", subject);
          resolve();
        } else {
          console.error("❌ SNS error response:", res.statusCode, data);
          reject(new Error(`SNS HTTP ${res.statusCode}`));
        }
      });
    });
 
    req.on("error", (e) => {
      console.error("❌ SNS request error:", e.message);
      reject(e);
    });
 
    req.write(bodyStr);
    req.end();
  });
}
 
// ── Helper: forward selfie to EC2 → S3 ──────────────────────────
function uploadToEC2(payload) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(payload);
    const options = {
      hostname: EC2_HOST,
      port:     EC2_PORT,
      path:     "/upload-selfie",
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
 
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success && parsed.s3Url) resolve(parsed.s3Url);
          else reject(new Error(parsed.error || "EC2 upload returned no URL"));
        } catch {
          reject(new Error("Invalid JSON response from EC2"));
        }
      });
    });
 
    req.on("error", (err) => reject(err));
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error("EC2 request timed out after 20s"));
    });
 
    req.write(body);
    req.end();
  });
}
 
// ── GET all entries ──────────────────────────────────────────────
app.get("/api/entries", (req, res) => {
  res.json(loadEntries());
});
 
// ── POST punch ───────────────────────────────────────────────────
app.post("/api/punch", async (req, res) => {
  const { type, user, manualDate, manualTime, selfie } = req.body;
 
  if (!type) return res.status(400).json({ message: "Action type is required." });
  if (!user) return res.status(400).json({ message: "User is required." });
 
  const timestamp = (manualDate && manualTime)
    ? new Date(`${manualDate}T${manualTime}`).toISOString()
    : new Date().toISOString();
 
  // Step 1 — Upload selfie to S3 via EC2
  let finalSelfieUrl = null;
  if (selfie) {
    try {
      console.log(`⬆️  Forwarding selfie to EC2 for ${user} - ${type}`);
      finalSelfieUrl = await uploadToEC2({ imageBase64: selfie, user, actionType: type, timestamp });
      console.log("✅ S3 URL received:", finalSelfieUrl);
    } catch (err) {
      console.error("❌ EC2 upload failed:", err.message);
      return res.status(502).json({
        message: `Selfie upload to S3 failed: ${err.message}`,
        hint:    "Check EC2 is running and Security Group port 5000 is open",
      });
    }
  }
 
  // Step 2 — Save punch entry
  const entry = {
    type,
    user:   user.trim(),
    time:   timestamp,
    selfie: finalSelfieUrl,
  };
 
  const entries = loadEntries();
  entries.push(entry);
  saveEntries(entries);
  console.log(`✅ Punch saved: ${type} for ${user} | selfie: ${finalSelfieUrl || "none"}`);
 
  // Step 3 — Send SNS notification (non-blocking — don't fail punch if SNS fails)
  sendSNSNotification(user, type, timestamp, finalSelfieUrl)
    .catch(err => console.error("⚠️  SNS notification failed (punch still saved):", err.message));
 
  res.json({ message: `${type} recorded successfully for ${user}.`, entry });
});
 
// ── DELETE all entries ───────────────────────────────────────────
app.delete("/api/entries", (req, res) => {
  saveEntries([]);
  res.json({ message: "All entries cleared." });
});
 
// ── EC2 health check ─────────────────────────────────────────────
app.get("/api/ec2-health", (req, res) => {
  const options = {
    hostname: EC2_HOST,
    port:     EC2_PORT,
    path:     "/health",
    method:   "GET",
  };
  const probe = http.request(options, (r) => {
    let d = "";
    r.on("data", c => d += c);
    r.on("end", () => {
      try { res.json({ ec2: "reachable", host: EC2_HOST, response: JSON.parse(d) }); }
      catch { res.json({ ec2: "reachable but bad JSON", host: EC2_HOST }); }
    });
  });
  probe.on("error", (e) => res.json({ ec2: "unreachable", host: EC2_HOST, error: e.message }));
  probe.setTimeout(5000, () => { probe.destroy(); res.json({ ec2: "timeout", host: EC2_HOST }); });
  probe.end();
});
 
// ── Fallback to React ────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/build/index.html"));
});
 
const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`server started on port ${PORT}`);
  console.log(`EC2 backend  : ${EC2_HOST}:${EC2_PORT}`);
  console.log(`SNS topic    : ${SNS_TOPIC_ARN || "NOT CONFIGURED"}`);
});
 
