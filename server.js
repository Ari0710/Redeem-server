require("dotenv").config();
const express = require("express");
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken");
const TelegramBot = require("node-telegram-bot-api");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// ================= FIREBASE INIT =================
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

// ================= TELEGRAM BOT =================
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
app.post("/bot", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;
let userStates = {};

// ================= START MENU =================
function mainMenu(chatId) {
  bot.sendMessage(chatId, "📊 SaaS Admin Panel", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ Create License", callback_data: "create_license" }],
        [{ text: "🔍 Manage License", callback_data: "manage_license" }],
        [{ text: "📈 View Stats", callback_data: "stats" }]
      ]
    }
  });
}

// ================= CALLBACK HANDLER =================
bot.on("callback_query", async (query) => {

  if (query.from.id.toString() !== ADMIN_ID)
    return bot.answerCallbackQuery(query.id, { text: "Unauthorized" });

  const chatId = query.message.chat.id;
  const data = query.data;

  if (data === "create_license") {
    userStates[chatId] = { step: "ask_name" };
    bot.sendMessage(chatId, "Enter Customer Name:");
  }

  if (data === "manage_license") {
    userStates[chatId] = { step: "manage_key" };
    bot.sendMessage(chatId, "Enter License Key to Manage:");
  }

  if (data.startsWith("validity_")) {
    const months = parseInt(data.split("_")[1]);
    const state = userStates[chatId];

    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + months);

    const licenseKey = "LIC-" + crypto.randomBytes(4).toString("hex").toUpperCase();

    await db.collection("licenses").doc(licenseKey).set({
      name: state.name,
      contact: state.contact,
      plan: `${months} Month`,
      expiryDate: expiry,
      maxDevices: 1,
      devices: [],
      status: "active",
      createdAt: new Date()
    });

    bot.sendMessage(chatId,
      `✅ License Created\n\n` +
      `Name: ${state.name}\n` +
      `Contact: ${state.contact}\n` +
      `Plan: ${months} Month\n` +
      `License Key: ${licenseKey}`
    );

    delete userStates[chatId];
    mainMenu(chatId);
  }
});

// ================= MESSAGE HANDLER =================
bot.on("message", async (msg) => {

  if (msg.from.id.toString() !== ADMIN_ID)
    return;

  const chatId = msg.chat.id;
  const state = userStates[chatId];

  if (!state) {
    mainMenu(chatId);
    return;
  }

  if (state.step === "ask_name") {
    state.name = msg.text;
    state.step = "ask_contact";
    bot.sendMessage(chatId, "Enter Contact Number:");
    return;
  }

  if (state.step === "ask_contact") {
    state.contact = msg.text;
    state.step = "choose_validity";

    bot.sendMessage(chatId, "Select Validity:", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "1 Month", callback_data: "validity_1" },
            { text: "2 Months", callback_data: "validity_2" }
          ],
          [
            { text: "3 Months", callback_data: "validity_3" }
          ]
        ]
      }
    });
    return;
  }

  if (state.step === "manage_key") {
    const key = msg.text;
    const snap = await db.collection("licenses").doc(key).get();

    if (!snap.exists) {
      bot.sendMessage(chatId, "❌ License Not Found");
      return mainMenu(chatId);
    }

    const data = snap.data();

    bot.sendMessage(chatId,
      `📄 License Info\n\n` +
      `Name: ${data.name}\n` +
      `Contact: ${data.contact}\n` +
      `Plan: ${data.plan}\n` +
      `Status: ${data.status}\n` +
      `Devices: ${data.devices.length}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Reset Device", callback_data: "reset_" + key }],
            [{ text: "🚫 Disable", callback_data: "disable_" + key }]
          ]
        }
      }
    );

    delete userStates[chatId];
  }
});

// ================= RESET & DISABLE =================
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith("reset_")) {
    const key = data.split("_")[1];
    await db.collection("licenses").doc(key).update({ devices: [] });
    bot.sendMessage(chatId, "🔄 Device Reset Done");
  }

  if (data.startsWith("disable_")) {
    const key = data.split("_")[1];
    await db.collection("licenses").doc(key).update({ status: "disabled" });
    bot.sendMessage(chatId, "🚫 License Disabled");
  }
});

// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("SaaS Admin Server Running");
});

app.listen(process.env.PORT, () => {
  console.log("Server running...");
});
