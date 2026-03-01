require("dotenv").config();
const express = require("express");
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const TelegramBot = require("node-telegram-bot-api");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}));

// ================= FIREBASE INIT =================
const serviceAccount = require("./config/serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ================= TELEGRAM BOT INIT =================
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// Webhook endpoint
app.post("/bot", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ================= LICENSE ACTIVATE =================
app.post("/activate", async (req, res) => {
  try {
    const { licenseKey, deviceId } = req.body;

    const licenseRef = db.collection("licenses").doc(licenseKey);
    const snap = await licenseRef.get();

    if (!snap.exists) return res.status(404).json({ error: "Invalid license" });

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
      await licenseRef.update({ devices });
    }

    const token = jwt.sign(
      { licenseKey, deviceId },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({ token });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ================= LICENSE VALIDATE =================
app.post("/validate", async (req, res) => {
  try {
    const { token } = req.body;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const snap = await db.collection("licenses")
      .doc(decoded.licenseKey).get();

    if (!snap.exists) return res.status(403).json({ error: "Invalid" });

    const data = snap.data();

    if (data.status !== "active")
      return res.status(403).json({ error: "Disabled" });

    if (new Date() > data.expiryDate.toDate())
      return res.status(403).json({ error: "Expired" });

    if (!data.devices.includes(decoded.deviceId))
      return res.status(403).json({ error: "Unauthorized device" });

    res.json({ valid: true, plan: data.plan });

  } catch (err) {
    res.status(403).json({ error: "Invalid token" });
  }
});

// ================= TELEGRAM ADMIN COMMANDS =================
bot.on("message", async (msg) => {

  if (msg.from.id.toString() !== process.env.ADMIN_TELEGRAM_ID)
    return bot.sendMessage(msg.chat.id, "Unauthorized");

  const text = msg.text;
  const args = text.split(" ");

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
    await db.collection("licenses").doc(args[1])
      .update({ status: "disabled" });

    bot.sendMessage(msg.chat.id, "License disabled");
  }

  // /reset LICENSE
  if (args[0] === "/reset") {
    await db.collection("licenses").doc(args[1])
      .update({ devices: [] });

    bot.sendMessage(msg.chat.id, "Devices reset");
  }
});

app.get("/", (req, res) => {
  res.send("SaaS License Server Running");
});

app.listen(process.env.PORT, () => {
  console.log("Server running...");
});
