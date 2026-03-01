require("dotenv").config();
const express = require("express");
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const TelegramBot = require("node-telegram-bot-api");

const app = express();

// ================= SECURITY =================
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}));

// ================= FIREBASE INIT (ENV METHOD) =================
admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
  })
});

const db = admin.firestore();

// ================= TELEGRAM BOT (WEBHOOK MODE) =================
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// Telegram webhook endpoint
app.post("/bot", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ================= LICENSE ACTIVATE =================
app.post("/activate", async (req, res) => {
  try {
    const { licenseKey, deviceId } = req.body;

    if (!licenseKey || !deviceId)
      return res.status(400).json({ error: "Missing data" });

    const ref = db.collection("licenses").doc(licenseKey);
    const snap = await ref.get();

    if (!snap.exists)
      return res.status(404).json({ error: "Invalid license" });

    const data = snap.data();

    if (data.status !== "active")
      return res.status(403).json({ error: "License disabled" });

    if (new Date() > data.expiryDate.toDate())
      return res.status(403).json({ error: "License expired" });

    let devices = data.devices || [];

    if (!devices.includes(deviceId)) {
      if (devices.length >= data.maxDevices)
        return res.status(403).json({ error: "Device limit reached" });

      devices.push(deviceId);
      await ref.update({ devices });
    }

    const token = jwt.sign(
      { licenseKey, deviceId },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      message: "Activated successfully",
      token,
      plan: data.plan
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ================= LICENSE VALIDATE =================
app.post("/validate", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token)
      return res.status(400).json({ error: "Token missing" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const snap = await db.collection("licenses")
      .doc(decoded.licenseKey).get();

    if (!snap.exists)
      return res.status(403).json({ error: "Invalid license" });

    const data = snap.data();

    if (data.status !== "active")
      return res.status(403).json({ error: "Disabled" });

    if (new Date() > data.expiryDate.toDate())
      return res.status(403).json({ error: "Expired" });

    if (!data.devices.includes(decoded.deviceId))
      return res.status(403).json({ error: "Unauthorized device" });

    res.json({
      valid: true,
      plan: data.plan,
      expiry: data.expiryDate
    });

  } catch (err) {
    res.status(403).json({ error: "Invalid token" });
  }
});

// ================= TELEGRAM ADMIN COMMANDS =================
bot.on("message", async (msg) => {

  if (msg.from.id.toString() !== process.env.ADMIN_TELEGRAM_ID)
    return bot.sendMessage(msg.chat.id, "Unauthorized");

  const args = msg.text.split(" ");

  try {

    // /create LICENSE 30
    if (args[0] === "/create") {
      const key = args[1];
      const days = parseInt(args[2]);

      const expiry = new Date();
      expiry.setDate(expiry.getDate() + days);

      await db.collection("licenses").doc(key).set({
        plan: "custom",
        expiryDate: expiry,
        maxDevices: 1,
        devices: [],
        status: "active",
        createdAt: new Date()
      });

      bot.sendMessage(msg.chat.id, `License ${key} created`);
    }

    // /disable LICENSE
    if (args[0] === "/disable") {
      await db.collection("licenses")
        .doc(args[1])
        .update({ status: "disabled" });

      bot.sendMessage(msg.chat.id, "License disabled");
    }

    // /reset LICENSE
    if (args[0] === "/reset") {
      await db.collection("licenses")
        .doc(args[1])
        .update({ devices: [] });

      bot.sendMessage(msg.chat.id, "Device list reset");
    }

  } catch (err) {
    bot.sendMessage(msg.chat.id, "Error processing command");
  }
});

// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("SaaS License Server Running");
});

app.listen(process.env.PORT, () => {
  console.log("Server running on port " + process.env.PORT);
});
