import { Telegraf, Markup } from 'telegraf';
import express from 'express';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  setDoc,
  addDoc
} from 'firebase/firestore';

// Get environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

// Validate required environment variables on startup
if (!BOT_TOKEN) {
  console.error('FATAL: BOT_TOKEN environment variable is required');
  process.exit(1);
}
if (!ADMIN_ID) {
  console.error('FATAL: ADMIN_ID environment variable is required');
  process.exit(1);
}

// Firebase config from environment variables
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Initialize everything with error handling
let app, db;
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (err) {
  console.error('FATAL: Firebase initialization failed:', err);
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Simple in-memory session storage
const userSessions = new Map();

// Simple session middleware
bot.use((ctx, next) => {
  const userId = ctx.from?.id;
  if (userId) {
    if (!userSessions.has(userId)) {
      userSessions.set(userId, {});
    }
    ctx.session = userSessions.get(userId);
  }
  return next();
});

// Create Express server
const expressApp = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint
expressApp.get("/", (req, res) => {
  res.send("Admin Bot is running!");
});

// Additional health check endpoint
expressApp.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Start Express server
expressApp.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// ==================== HELPER FUNCTIONS ====================

// Check if user is admin
function isAdmin(ctx) {
  return ctx.from.id.toString() === ADMIN_ID;
}

// Send admin-only message
function adminOnly(ctx) {
  ctx.reply('This command is for admin only.');
}

// Format user data for display
function formatUserData(userData) {
  return `
*New User Registration*

Username: \`${userData.username}\`
Name: ${userData.name}
Email: \`${userData.email}\`
Device ID: \`${userData.deviceId}\`
Registered: ${new Date(userData.createdAt).toLocaleString()}
`;
}

// Main menu
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('Pending Approvals', 'pending')],
  [Markup.button.callback('All Users', 'users')],
  [Markup.button.callback('Search User', 'search')],
  [Markup.button.callback('Statistics', 'stats')]
]);

// Approve/Reject buttons with plan selection
function approvalButtons(email) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('1 Month', `approve:${email}:basic:30`)],
    [Markup.button.callback('3 Months', `approve:${email}:premium:90`)],
    [Markup.button.callback('Lifetime', `approve:${email}:lifetime:-1`)],
    [Markup.button.callback('Custom (Days)', `custom:${email}`)],
    [Markup.button.callback('Reject', `reject:${email}`)],
    [Markup.button.callback('Back', 'pending')]
  ]);
}

// User action buttons
function userActionButtons(email, isBanned = false, mimicEnabled = true) {
  const buttons = [
    [
      Markup.button.callback('Activate', `activate:${email}`),
      Markup.button.callback('Deactivate', `deactivate:${email}`)
    ],
    [
      Markup.button.callback('Reset Password', `reset:${email}`),
      Markup.button.callback('Change Validity', `validity:${email}`)
    ],
    [
      Markup.button.callback('Unbind Device', `unbind:${email}`)
    ]
  ];
  
  // Add Mimic toggle button (treat undefined/null as true for backward compatibility)
  const mimicAllowed = mimicEnabled !== false;
  if (mimicAllowed) {
    buttons.push([Markup.button.callback('🔇 Disable Mimic', `mimic_off:${email}`)]);
  } else {
    buttons.push([Markup.button.callback('🔊 Enable Mimic', `mimic_on:${email}`)]);
  }
  
  // Add Ban/Unban button
  if (isBanned) {
    buttons.push([Markup.button.callback('✅ Unban User', `unban:${email}`)]);
  } else {
    buttons.push([Markup.button.callback('🚫 Ban User', `ban:${email}`)]);
  }
  
  buttons.push([Markup.button.callback('Back', 'users')]);
  
  return Markup.inlineKeyboard(buttons);
}

// ==================== BOT COMMANDS ====================

// Start command
bot.start(async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('Welcome! This bot is for admin use only.');
  }
  
  ctx.reply(
    '*Admin Panel - Redeem Bot V3*\n\n' +
    'Welcome Admin! Use the menu below to manage users.',
    { parse_mode: 'Markdown', ...mainMenu }
  );
});

// Help command
bot.help((ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  ctx.reply(`
*Available Commands:*

/start - Open admin panel
/pending - View pending approvals
/users - View all users
/search <email> - Search user by email
/approve <email> - Approve a user
/deactivate <email> - Deactivate user
/reset <email> - Reset user password
/mimic <email> on|off - Toggle mimic mode for user
/stats - View statistics

*Features:*
- Get notified when new users register
- Approve/reject users with one click
- Activate/deactivate licenses
- Reset passwords
- Change license validity
- Enable/disable mimic mode per user
  `, { parse_mode: 'Markdown' });
});

// Mimic command - toggle mimic mode for a user
bot.command('mimic', async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length < 2) {
    return ctx.reply(
      'Usage: `/mimic <email> on|off`\n\n' +
      'Examples:\n' +
      '`/mimic user@example.com on` - Enable mimic mode\n' +
      '`/mimic user@example.com off` - Disable mimic mode',
      { parse_mode: 'Markdown' }
    );
  }
  
  const email = args[0];
  const action = args[1].toLowerCase();
  
  if (!['on', 'off'].includes(action)) {
    return ctx.reply('Invalid action. Use `on` or `off`.', { parse_mode: 'Markdown' });
  }
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
    
    if (!userDocSnap.exists()) {
      return ctx.reply('User not found.');
    }
    
    const mimicEnabled = action === 'on';
    
    await setDoc(userDocRef, { mimicEnabled }, { merge: true });
    
    // Log admin action (non-blocking)
    addDoc(collection(db, 'adminLogs'), {
      action: mimicEnabled ? 'mimic_enable' : 'mimic_disable',
      email,
      adminId: ctx.from.id,
      adminUsername: ctx.from.username || 'unknown',
      timestamp: new Date().toISOString()
    }).catch(e => console.error('Admin log write failed:', e.message));
    
    const statusText = mimicEnabled ? '✅ enabled' : '🔇 disabled';
    ctx.reply(`Mimic mode ${statusText} for \`${email}\`.`, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error toggling mimic mode:', error);
    ctx.reply('Error: ' + error.message);
  }
});

// ==================== CALLBACK HANDLERS ====================

// Pending approvals
bot.action('pending', async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  try {
    const q = collection(db, 'pendingApprovals');
    const snapshot = await getDocs(q);
    
    const buttons = [];
    let text;
    
    if (snapshot.empty) {
      text = '*Pending Approvals*\n\n_No pending approvals._';
    } else {
      text = '*Pending Approvals*\n\n';
      snapshot.forEach((doc) => {
        const data = doc.data();
        text += `- ${data.username} (${data.email})\n`;
        buttons.push([Markup.button.callback(
          `View: ${data.username}`,
          `view:${data.email}`
        )]);
      });
    }
    
    buttons.push([Markup.button.callback('Back', 'menu')]);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  } catch (error) {
    if (error && error.description && error.description.includes('message is not modified')) {
      return;
    }
    ctx.reply('Error: ' + error.message);
  }
});

// View specific user
bot.action(/view:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  try {
    const docRef = doc(db, 'pendingApprovals', email);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      ctx.editMessageText(
        formatUserData(data),
        { parse_mode: 'Markdown', ...approvalButtons(email) }
      );
    } else {
      ctx.reply('User not found in pending approvals.');
    }
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// Approve user with plan selection
bot.action(/approve:(.+):(.+):(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  const planType = ctx.match[2];
  const days = parseInt(ctx.match[3]);
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
        
    if (!userDocSnap.exists()) {
      return ctx.reply('User not found.');
    }
        
    const userDoc = userDocSnap;
      
    const expiresAt = days === -1 ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        
    await updateDoc(doc(db, 'users', userDoc.id), {
      approved: true,
      licenseActive: true,
      licenseType: planType,
      licenseExpiresAt: expiresAt,
      licenseActivatedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      approvedBy: 'admin-bot'
    });
    
    await deleteDoc(doc(db, 'pendingApprovals', email));
    
    await addDoc(collection(db, 'adminLogs'), {
      action: 'approve',
      email,
      planType,
      days,
      adminId: ctx.from.id,
      adminUsername: ctx.from.username || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    const validityText = days === -1 ? 'Lifetime' : `${days} days`;
    
    ctx.editMessageText(
      `*User Approved*\n\n` +
      `Email: \`${email}\`\n` +
      `Plan: ${planType.charAt(0).toUpperCase() + planType.slice(1)}\n` +
      `Validity: ${validityText}`,
      { parse_mode: 'Markdown', ...mainMenu }
    );
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// Custom days input
bot.action(/custom:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  if (!ctx.session) {
    ctx.session = {};
  }
  ctx.session.customApproveEmail = email;
  
  ctx.editMessageText(
    `Enter number of days for custom license:\n\nExample: 45`,
    { 
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('Cancel', 'pending')]
      ])
    }
  );
});

// Handle custom days input
bot.on('text', async (ctx) => {
  if (!isAdmin(ctx) || !ctx.session || !ctx.session.customApproveEmail) return;
  
  const email = ctx.session.customApproveEmail;
  const days = parseInt(ctx.message.text);
  
  if (isNaN(days) || days <= 0) {
    return ctx.reply('Please enter a valid number of days.');
  }
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
        
    if (!userDocSnap.exists()) {
      return ctx.reply('User not found.');
    }
        
    const userDoc = userDocSnap;
        
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        
    await updateDoc(doc(db, 'users', userDoc.id), {
      approved: true,
      licenseActive: true,
      licenseType: 'custom',
      licenseExpiresAt: expiresAt,
      licenseActivatedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      approvedBy: 'admin-bot'
    });
    
    await deleteDoc(doc(db, 'pendingApprovals', email));
    
    await addDoc(collection(db, 'adminLogs'), {
      action: 'approve_custom',
      email,
      planType: 'custom',
      days,
      adminId: ctx.from.id,
      adminUsername: ctx.from.username || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    ctx.reply(
      `*User Approved*\n\n` +
      `Email: \`${email}\`\n` +
      `Plan: Custom\n` +
      `Validity: ${days} days`,
      { parse_mode: 'Markdown', ...mainMenu }
    );
    
    if (ctx.session) {
      delete ctx.session.customApproveEmail;
    }
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// Reject user
bot.action(/reject:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  ctx.editMessageText(
    `*Confirm Action*\n\nAre you sure you want to reject this user?\nEmail: \`${email}\`\n\nThis action cannot be undone easily.`,
    { 
      parse_mode: 'Markdown', 
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Yes, Reject', `confirm_reject:${email}`)],
        [Markup.button.callback('Cancel', 'pending')]
      ])
    }
  );
});

// Confirm reject user
bot.action(/confirm_reject:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  try {
    const pendingDocRef = doc(db, 'pendingApprovals', email);
    const pendingDocSnap = await getDoc(pendingDocRef);
    
    if (pendingDocSnap.exists()) {
      const userData = pendingDocSnap.data();
      
      await setDoc(doc(db, 'users', pendingDocSnap.id), {
        ...userData,
        approved: false,
        licenseActive: false,
        licenseType: "rejected",
        licenseExpiresAt: null,
        rejectedAt: new Date().toISOString(),
        rejectedBy: ctx.from.id.toString()
      });
      
      await deleteDoc(pendingDocRef);
      
      await addDoc(collection(db, 'adminLogs'), {
        action: 'reject',
        email,
        adminId: ctx.from.id,
        adminUsername: ctx.from.username || 'unknown',
        timestamp: new Date().toISOString()
      });
      
      ctx.editMessageText(
        `*User Rejected*\n\nEmail: \`${email}\``,
        { parse_mode: 'Markdown', ...mainMenu }
      );
    } else {
      ctx.reply('User not found in pending approvals.');
    }
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// All users with pagination
bot.action('users', async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  if (!ctx.session) {
    ctx.session = {};
  }
  
  if (typeof ctx.session.userPage !== 'number') {
    ctx.session.userPage = 0;
  }
  
  try {
    const snapshot = await getDocs(collection(db, 'users'));
    
    if (snapshot.empty) {
      return ctx.editMessageText(
        '*All Users*\n\nNo users found.',
        { parse_mode: 'Markdown', ...mainMenu }
      );
    }
    
    const allUsers = snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data()
    })).sort((a, b) => a.data.username.localeCompare(b.data.username));
    
    const USERS_PER_PAGE = 10;
    const totalPages = Math.ceil(allUsers.length / USERS_PER_PAGE);
    const currentPage = ctx.session.userPage;
    
    const startIndex = currentPage * USERS_PER_PAGE;
    const endIndex = Math.min(startIndex + USERS_PER_PAGE, allUsers.length);
    const usersToShow = allUsers.slice(startIndex, endIndex);
    
    let text = `*All Users* (Page ${currentPage + 1}/${totalPages})\n\n`;
    const buttons = [];
    
    usersToShow.forEach(user => {
      const data = user.data;
      let status = '?';
      if (data.approved && data.licenseActive) status = 'Active';
      else if (data.approved && !data.licenseActive) status = 'Inactive';
      else if (data.licenseType === 'rejected') status = 'Rejected';
      else if (!data.approved) status = 'Pending';
      
      text += `[${status}] ${data.username} (${data.email})\n`;
      buttons.push([Markup.button.callback(
        `Manage: ${data.username}`,
        `manage:${data.email}`
      )]);
    });
    
    const paginationButtons = [];
    
    if (currentPage > 0) {
      paginationButtons.push(Markup.button.callback('Previous', 'prev_users'));
    }
    
    if (endIndex < allUsers.length) {
      paginationButtons.push(Markup.button.callback('Next', 'next_users'));
    }
    
    buttons.push(paginationButtons);
    buttons.push([Markup.button.callback('Back', 'menu')]);
    
    ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// Previous page callback
bot.action('prev_users', async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  if (!ctx.session) {
    ctx.session = {};
  }
  
  if (typeof ctx.session.userPage !== 'number') {
    ctx.session.userPage = 0;
  }
  
  if (ctx.session.userPage > 0) {
    ctx.session.userPage--;
  }
  
  await ctx.answerCbQuery();
  await bot.handleUpdate({
    update_id: Date.now(),
    callback_query: {
      id: ctx.callbackQuery.id,
      from: ctx.from,
      message: ctx.message,
      data: 'users',
      chat_instance: ctx.callbackQuery.chat_instance
    }
  });
});

// Next page callback
bot.action('next_users', async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  if (!ctx.session) {
    ctx.session = {};
  }
  
  if (typeof ctx.session.userPage !== 'number') {
    ctx.session.userPage = 0;
  }
  
  const snapshot = await getDocs(collection(db, 'users'));
  const totalUsers = snapshot.size;
  const USERS_PER_PAGE = 10;
  const totalPages = Math.ceil(totalUsers / USERS_PER_PAGE);
  
  if (ctx.session.userPage < totalPages - 1) {
    ctx.session.userPage++;
  }
  
  await ctx.answerCbQuery();
  await bot.handleUpdate({
    update_id: Date.now(),
    callback_query: {
      id: ctx.callbackQuery.id,
      from: ctx.from,
      message: ctx.message,
      data: 'users',
      chat_instance: ctx.callbackQuery.chat_instance
    }
  });
});

// Manage specific user
bot.action(/manage:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
    
    if (userDocSnap.exists()) {
      const data = userDocSnap.data();
      
      let status = 'Unknown';
      if (data.banned) status = 'BANNED';
      else if (data.approved && data.licenseActive) status = 'Approved & Active';
      else if (data.approved && !data.licenseActive) status = 'Approved & Inactive';
      else if (data.licenseType === 'rejected') status = 'Rejected';
      else if (!data.approved) status = 'Pending Approval';
      
      const license = data.licenseActive ? 'Active' : 'Inactive';
      
      // Check mimic status (treat undefined/null as true for backward compatibility)
      const mimicStatus = data.mimicEnabled !== false ? '✅ Enabled' : '❌ Disabled';
      
      ctx.editMessageText(
        `*User Details*\n\n` +
        `Username: ${data.username}\n` +
        `Name: ${data.name}\n` +
        `Email: \`${data.email}\`\n` +
        `Status: ${status}\n` +
        `License: ${license}\n` +
        `Expires: ${data.licenseExpiresAt ? new Date(data.licenseExpiresAt).toLocaleDateString() : 'N/A'}\n` +
        `Device ID: \`${data.deviceId || 'Not bound'}\`\n` +
        `Mimic Mode: ${mimicStatus}` +
        (data.banned ? `\n\n⚠️ *BANNED* at ${data.bannedAt ? new Date(data.bannedAt).toLocaleString() : 'Unknown'}\nReason: ${data.bannedReason || 'No reason provided'}` : ''),
        { parse_mode: 'Markdown', ...userActionButtons(email, data.banned === true, data.mimicEnabled) }
      );
    }
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// Activate license
bot.action(/activate:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
    
    if (userDocSnap.exists()) {
      await updateDoc(doc(db, 'users', userDocSnap.id), {
        approved: true,
        licenseActive: true,
        licenseExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });
      
      await addDoc(collection(db, 'adminLogs'), {
        action: 'activate',
        email,
        adminId: ctx.from.id,
        adminUsername: ctx.from.username || 'unknown',
        timestamp: new Date().toISOString()
      });
      
      ctx.reply(`License activated for ${email}`);
    }
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// Deactivate license
bot.action(/deactivate:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
    
    if (userDocSnap.exists()) {
      await updateDoc(doc(db, 'users', userDocSnap.id), {
        licenseActive: false
      });
      
      await addDoc(collection(db, 'adminLogs'), {
        action: 'deactivate',
        email,
        adminId: ctx.from.id,
        adminUsername: ctx.from.username || 'unknown',
        timestamp: new Date().toISOString()
      });
      
      ctx.reply(`License deactivated for ${email}`);
    }
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// Unbind device
bot.action(/unbind:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
    
    if (userDocSnap.exists()) {
      await updateDoc(doc(db, 'users', userDocSnap.id), {
        deviceId: null
      });
      
      await addDoc(collection(db, 'adminLogs'), {
        action: 'unbind',
        email,
        adminId: ctx.from.id,
        adminUsername: ctx.from.username || 'unknown',
        timestamp: new Date().toISOString()
      });
      
      ctx.reply(`Device unbound for ${email}`);
    } else {
      ctx.reply('User not found.');
    }
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// Reset password
bot.action(/reset:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  const tempPassword = Math.random().toString(36).slice(-8);
  
  ctx.reply(
    `*Password Reset*\n\n` +
    `Email: \`${email}\`\n` +
    `Temp Password: \`${tempPassword}\`\n\n` +
    `Note: You need to manually update this in Firebase Auth console.`,
    { parse_mode: 'Markdown' }
  );
});

// Change validity
bot.action(/validity:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  ctx.reply(
    'Select validity period:',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('7 days', `setvalid:${email}:7`),
        Markup.button.callback('30 days', `setvalid:${email}:30`)
      ],
      [
        Markup.button.callback('90 days', `setvalid:${email}:90`),
        Markup.button.callback('Lifetime', `setvalid:${email}:-1`)
      ]
    ])
  );
});

// Set validity
bot.action(/setvalid:(.+):(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  const days = parseInt(ctx.match[2]);
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
    
    if (userDocSnap.exists()) {
      const expiresAt = days === -1 
        ? null 
        : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      
      await updateDoc(doc(db, 'users', userDocSnap.id), {
        licenseExpiresAt: expiresAt
      });
      
      await addDoc(collection(db, 'adminLogs'), {
        action: 'change_validity',
        email,
        days,
        adminId: ctx.from.id,
        adminUsername: ctx.from.username || 'unknown',
        timestamp: new Date().toISOString()
      });
      
      ctx.reply(`Validity updated for ${email}: ${days === -1 ? 'Lifetime' : days + ' days'}`);
    }
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// Handle ban_user callback from login event notifications
bot.action(/ban_user_(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
    
    if (!userDocSnap.exists()) {
      await ctx.answerCbQuery('User not found');
      return ctx.reply('User not found.');
    }
    
    await updateDoc(doc(db, 'users', email), {
      licenseActive: false,
      approved: false,
      banned: true,
      bannedAt: new Date().toISOString(),
      bannedReason: 'Multi-device usage detected'
    });
    
    await addDoc(collection(db, 'adminLogs'), {
      action: 'ban',
      email,
      adminId: ctx.from.id,
      adminUsername: ctx.from.username || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    await ctx.answerCbQuery('User banned successfully');
    await ctx.reply(`✅ User \`${email}\` has been banned.`, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error banning user:', error);
    await ctx.answerCbQuery('Error banning user');
    ctx.reply('Error: ' + error.message);
  }
});

// Ban user from user management
bot.action(/ban:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
    
    if (!userDocSnap.exists()) {
      return ctx.reply('User not found.');
    }
    
    await updateDoc(doc(db, 'users', email), {
      licenseActive: false,
      approved: false,
      banned: true,
      bannedAt: new Date().toISOString(),
      bannedReason: 'Banned by admin'
    });
    
    await addDoc(collection(db, 'adminLogs'), {
      action: 'ban',
      email,
      adminId: ctx.from.id,
      adminUsername: ctx.from.username || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    ctx.reply(`✅ User \`${email}\` has been banned.`, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error banning user:', error);
    ctx.reply('Error: ' + error.message);
  }
});

// Unban user
bot.action(/unban:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
    
    if (!userDocSnap.exists()) {
      return ctx.reply('User not found.');
    }
    
    await updateDoc(doc(db, 'users', email), {
      banned: false,
      bannedAt: null,
      bannedReason: null,
      unbannedAt: new Date().toISOString(),
      unbannedBy: ctx.from.id.toString()
    });
    
    await addDoc(collection(db, 'adminLogs'), {
      action: 'unban',
      email,
      adminId: ctx.from.id,
      adminUsername: ctx.from.username || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    ctx.reply(`✅ User \`${email}\` has been unbanned.`, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error unbanning user:', error);
    ctx.reply('Error: ' + error.message);
  }
});

// Enable mimic mode for user
bot.action(/mimic_on:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
    
    if (!userDocSnap.exists()) {
      return ctx.reply('User not found.');
    }
    
    await setDoc(userDocRef, { mimicEnabled: true }, { merge: true });
    
    // Log admin action (non-blocking)
    addDoc(collection(db, 'adminLogs'), {
      action: 'mimic_enable',
      email,
      adminId: ctx.from.id,
      adminUsername: ctx.from.username || 'unknown',
      timestamp: new Date().toISOString()
    }).catch(e => console.error('Admin log write failed:', e.message));
    
    await ctx.answerCbQuery('Mimic mode enabled');
    ctx.reply(`✅ Mimic mode enabled for \`${email}\`.`, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error enabling mimic mode:', error);
    ctx.reply('Error: ' + error.message);
  }
});

// Disable mimic mode for user
bot.action(/mimic_off:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
    
    if (!userDocSnap.exists()) {
      return ctx.reply('User not found.');
    }
    
    await setDoc(userDocRef, { mimicEnabled: false }, { merge: true });
    
    // Log admin action (non-blocking)
    addDoc(collection(db, 'adminLogs'), {
      action: 'mimic_disable',
      email,
      adminId: ctx.from.id,
      adminUsername: ctx.from.username || 'unknown',
      timestamp: new Date().toISOString()
    }).catch(e => console.error('Admin log write failed:', e.message));
    
    await ctx.answerCbQuery('Mimic mode disabled');
    ctx.reply(`🔇 Mimic mode disabled for \`${email}\`.`, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error disabling mimic mode:', error);
    ctx.reply('Error: ' + error.message);
  }
});

// Back to menu
bot.action('menu', (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  ctx.editMessageText(
    '*Admin Panel - Redeem Bot V3*\n\n' +
    'Welcome Admin! Use the menu below to manage users.',
    { parse_mode: 'Markdown', ...mainMenu }
  );
});

// Statistics
bot.action('stats', async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  try {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const pendingSnapshot = await getDocs(collection(db, 'pendingApprovals'));
    
    let total = 0;
    let approved = 0;
    let active = 0;
    let rejected = 0;
    
    usersSnapshot.forEach((doc) => {
      const data = doc.data();
      total++;
      if (data.approved) approved++;
      if (data.licenseActive) active++;
      if (data.licenseType === 'rejected') rejected++;
    });
    
    ctx.editMessageText(
      `*Statistics*\n\n` +
      `Total Users: ${total}\n` +
      `Approved: ${approved}\n` +
      `Active Licenses: ${active}\n` +
      `Rejected: ${rejected}\n` +
      `Pending Approvals: ${pendingSnapshot.size}`,
      { parse_mode: 'Markdown', ...mainMenu }
    );
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// ==================== REAL-TIME NOTIFICATIONS ====================

function startNotifications() {
  const q = collection(db, 'pendingApprovals');
  
  onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const data = change.doc.data();
        bot.telegram.sendMessage(
          ADMIN_ID,
          formatUserData(data) + '\n\nUse /pending to approve/reject.',
          { parse_mode: 'Markdown', ...approvalButtons(data.email) }
        ).catch(err => console.error('Failed to send notification:', err));
      }
    });
  }, (err) => {
    console.error('Snapshot listener error:', err);
  });
  
  // Listen for login events
  const loginEventsRef = collection(db, 'loginEvents');
  onSnapshot(loginEventsRef, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === 'added') {
        const data = change.doc.data();
        
        if (data.multiDevice === true) {
          // Multi-device login detected - send warning with ban button
          const message = `⚠️ *MULTI-DEVICE LOGIN DETECTED*\n\n` +
            `Email: ${data.email || 'Unknown'}\n` +
            `Username: ${data.username || 'Unknown'}\n` +
            `Time: ${data.loginAt || 'Unknown'}\n` +
            `New Device: ${data.device || 'Unknown'}\n\n` +
            `This user logged in from a SECOND device while already having an active session!`;
          
          try {
            await bot.telegram.sendMessage(ADMIN_ID, message, {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[
                  { text: '🚫 Ban User', callback_data: `ban_user_${data.email}` }
                ]]
              }
            });
          } catch (err) {
            console.error('Failed to send multi-device warning:', err.message);
          }
        } else {
          // Normal login notification
          const message = `🔑 *Login Detected*\n\n` +
            `Email: ${data.email || 'Unknown'}\n` +
            `Username: ${data.username || 'Unknown'}\n` +
            `Time: ${data.loginAt || 'Unknown'}\n` +
            `Device: ${data.device || 'Unknown'}`;
          
          try {
            await bot.telegram.sendMessage(ADMIN_ID, message, { parse_mode: 'Markdown' });
          } catch (err) {
            console.error('Failed to send login notification:', err.message);
          }
        }
        
        // Optionally delete the event after processing to keep collection clean
        try {
          await deleteDoc(change.doc.ref);
        } catch (err) {
          console.error('Failed to delete login event:', err.message);
        }
      }
    });
  }, (err) => {
    console.error('Login events listener error:', err);
  });
  
  console.log('Notifications started');
}

// ==================== ERROR HANDLING ====================

bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  if (err.description && err.description.includes('message is not modified')) {
    return;
  }
  ctx.reply('An error occurred. Please try again.').catch(() => {});
});

// Auto-expire cron system for licenses
async function autoExpireLicenses() {
  try {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const now = new Date();
    
    for (const docSnap of usersSnapshot.docs) {
      const userData = docSnap.data();
      
      if (userData.licenseExpiresAt) {
        const expiryDate = new Date(userData.licenseExpiresAt);
        
        if (expiryDate < now && userData.licenseActive) {
          await updateDoc(doc(db, 'users', docSnap.id), {
            licenseActive: false
          });
          
          console.log(`License expired for user: ${userData.email}`);
        }
      }
    }
    
    console.log('Auto-expire check completed');
  } catch (error) {
    console.error('Error in auto-expire cron:', error);
  }
}

// Run auto-expire check every hour
const expireInterval = setInterval(autoExpireLicenses, 3600000);

// Keep-alive function to ping itself (for free tier)
function keepAlive() {
  const baseUrl = process.env.RENDER_EXTERNAL_URL;
  if (!baseUrl) {
    return;
  }
  fetch(baseUrl)
    .then(res => console.log(`Keep alive ping: ${res.status}`))
    .catch(err => console.log(`Keep alive error: ${err.message}`));
}

// Ping every 10 minutes to keep the service awake
if (process.env.NODE_ENV === 'production') {
  setInterval(keepAlive, 600000);
}

// ==================== START BOT ====================

const webhookUrl = process.env.RENDER_EXTERNAL_URL;
if (webhookUrl) {
  const webhookPath = `/bot${BOT_TOKEN}`;
  expressApp.use(bot.webhookCallback(webhookPath));
  bot.telegram.setWebhook(`${webhookUrl}${webhookPath}`)
    .then(() => console.log('Webhook set successfully'))
    .catch(err => console.error('Failed to set webhook:', err));
} else {
  console.log('RENDER_EXTERNAL_URL not set, starting in polling mode');
  bot.launch()
    .then(() => console.log('Bot started in polling mode'))
    .catch(err => console.error('Failed to start bot:', err));
}

console.log('Bot Started!');
startNotifications();

// Enable graceful stop with interval cleanup
process.once('SIGINT', () => { clearInterval(expireInterval); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { clearInterval(expireInterval); bot.stop('SIGTERM'); });
