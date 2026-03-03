import { Telegraf, Markup, session } from 'telegraf';
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

// Firebase config from environment variables
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Initialize everything
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const bot = new Telegraf(BOT_TOKEN);

// Use session middleware
bot.use(session());

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

// ==================== YOUR EXISTING BOT CODE STARTS HERE ====================

// Check if user is admin
function isAdmin(ctx) {
  return ctx.from.id.toString() === ADMIN_ID;
}

// Send admin-only message
function adminOnly(ctx) {
  ctx.reply('⛔ This command is for admin only.');
}

// Format user data for display
function formatUserData(userData) {
  return `
👤 *New User Registration*

📝 Username: \`${userData.username}\`
📛 Name: ${userData.name}
📧 Email: \`${userData.email}\`
🔑 Device ID: \`${userData.deviceId}\`
📅 Registered: ${new Date(userData.createdAt).toLocaleString()}
`;
}

// ==================== HELPER FUNCTIONS ====================

// Main menu
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('📋 Pending Approvals', 'pending')],
  [Markup.button.callback('👥 All Users', 'users')],
  [Markup.button.callback('🔍 Search User', 'search')],
  [Markup.button.callback('📊 Statistics', 'stats')]
]);

// Approve/Reject buttons with plan selection
function approvalButtons(email) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ 1 Month', `approve:${email}:basic:30`)],
    [Markup.button.callback('✅ 3 Months', `approve:${email}:premium:90`)],
    [Markup.button.callback('✅ Lifetime', `approve:${email}:lifetime:-1`)],
    [Markup.button.callback('✅ Custom (Days)', `custom:${email}`)],
    [Markup.button.callback('❌ Reject', `reject:${email}`)],
    [Markup.button.callback('🔙 Back', 'pending')]
  ]);
}

// User action buttons
function userActionButtons(email) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Activate', `activate:${email}`),
      Markup.button.callback('🛑 Deactivate', `deactivate:${email}`)
    ],
    [
      Markup.button.callback('🔑 Reset Password', `reset:${email}`),
      Markup.button.callback('⏱️ Change Validity', `validity:${email}`)
    ],
    [
      Markup.button.callback('🔓 Unbind Device', `unbind:${email}`)
    ],
    [Markup.button.callback('🔙 Back', 'users')]
  ]);
}

// ==================== BOT COMMANDS ====================

// Start command
bot.start(async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('Welcome! This bot is for admin use only.');
  }
  
  ctx.reply(
    '🔐 *Admin Panel - Redeem Bot V3*\n\n' +
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
/stats - View statistics

*Features:*
- Get notified when new users register
- Approve/reject users with one click
- Activate/deactivate licenses
- Reset passwords
- Change license validity
  `, { parse_mode: 'Markdown' });
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
      text = '📋 *Pending Approvals*\n\n_No pending approvals._';
    } else {
      text = '📋 *Pending Approvals*\n\n';
      snapshot.forEach((doc) => {
        const data = doc.data();
        text += `• ${data.username} (${data.email})\n`;
        buttons.push([Markup.button.callback(
          `View: ${data.username}`,
          `view:${data.email}`
        )]);
      });
    }
    
    buttons.push([Markup.button.callback('🔙 Back', 'menu')]);
    
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  } catch (error) {
    // Ignore "message not modified" error
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
    // Get user by email (using email as document ID)
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
        
    if (!userDocSnap.exists()) {
      return ctx.reply('User not found.');
    }
        
    const userDoc = userDocSnap;
    const userData = userDocSnap.data();
        
    // Check if email is verified
    if (!userData.emailVerified) {
      return ctx.reply('User email not verified.');
    }
        
    const expiresAt = days === -1 ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        
    await updateDoc(doc(db, 'users', userDoc.id), {
      approved: true,
      licenseActive: true,
      licenseType: planType,
      licenseExpiresAt: expiresAt,
      licenseActivatedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      approvedBy: 'admin-bot'
      // Note: deviceId is not cleared here - use unbind feature separately
    });
    
    // Remove from pending
    await deleteDoc(doc(db, 'pendingApprovals', email));
    
    // Log admin action
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
      `✅ *User Approved*\n\n` +
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
  
  // Store email in session for next message
  ctx.session = { customApproveEmail: email };
  
  ctx.editMessageText(
    `Enter number of days for custom license:\n\nExample: 45`,
    { 
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Cancel', 'pending')]
      ])
    }
  );
});

// Handle custom days input
bot.on('text', async (ctx) => {
  if (!isAdmin(ctx) || !ctx.session?.customApproveEmail) return;
  
  const email = ctx.session.customApproveEmail;
  const days = parseInt(ctx.message.text);
  
  if (isNaN(days) || days <= 0) {
    return ctx.reply('Please enter a valid number of days.');
  }
  
  try {
    // Get user by email (using email as document ID)
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
        
    if (!userDocSnap.exists()) {
      return ctx.reply('User not found.');
    }
        
    const userDoc = userDocSnap;
    const userData = userDocSnap.data();
        
    // Check if email is verified
    if (!userData.emailVerified) {
      return ctx.reply('User email not verified.');
    }
        
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        
    await updateDoc(doc(db, 'users', userDoc.id), {
      approved: true,
      licenseActive: true,
      licenseType: 'custom',
      licenseExpiresAt: expiresAt,
      licenseActivatedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      approvedBy: 'admin-bot'
      // Note: deviceId is not cleared here - use unbind feature separately
    });
    
    // Remove from pending
    await deleteDoc(doc(db, 'pendingApprovals', email));
    
    // Log admin action
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
      `✅ *User Approved*\n\n` +
      `Email: \`${email}\`\n` +
      `Plan: Custom\n` +
      `Validity: ${days} days`,
      { parse_mode: 'Markdown', ...mainMenu }
    );
    
    // Clear session
    delete ctx.session.customApproveEmail;
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// Reject user - FIXED: Now moves to users collection with rejected status
bot.action(/reject:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  // Show confirmation for reject action
  ctx.editMessageText(
    `⚠️ *Confirm Action*\n\nAre you sure you want to reject this user?\nEmail: \`${email}\`\n\nThis action cannot be undone easily.`,
    { 
      parse_mode: 'Markdown', 
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Yes, Reject', `confirm_reject:${email}`)],
        [Markup.button.callback('❌ Cancel', 'pending')]
      ])
    }
  );
});

// Confirm reject user
bot.action(/confirm_reject:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  try {
    // Get user data from pending approvals
    const pendingDocRef = doc(db, 'pendingApprovals', email);
    const pendingDocSnap = await getDoc(pendingDocRef);
    
    if (pendingDocSnap.exists()) {
      const userData = pendingDocSnap.data();
      
      // Move user to users collection with rejected status
      await setDoc(doc(db, 'users', pendingDocSnap.id), {
        ...userData,
        approved: false,
        licenseActive: false,
        licenseType: "rejected",
        licenseExpiresAt: null,
        rejectedAt: new Date().toISOString(),
        rejectedBy: ctx.from.id.toString()
      });
      
      // Remove from pending approvals
      await deleteDoc(pendingDocRef);
      
      // Log admin action
      await addDoc(collection(db, 'adminLogs'), {
        action: 'reject',
        email,
        adminId: ctx.from.id,
        adminUsername: ctx.from.username || 'unknown',
        timestamp: new Date().toISOString()
      });
      
      ctx.editMessageText(
        `❌ *User Rejected*\n\nEmail: \`${email}\``,
        { parse_mode: 'Markdown', ...mainMenu }
      );
    } else {
      ctx.reply('User not found in pending approvals.');
    }
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// All users - FIXED: Now shows rejected users as well with pagination
bot.action('users', async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  // Set default page to 0 if not set
  if (!ctx.session.userPage) {
    ctx.session.userPage = 0;
  }
  
  try {
    const snapshot = await getDocs(collection(db, 'users'));
    
    if (snapshot.empty) {
      return ctx.editMessageText(
        '👥 *All Users*\n\nNo users found.',
        { parse_mode: 'Markdown', ...mainMenu }
      );
    }
    
    // Convert to array and sort for consistent pagination
    const allUsers = snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data()
    })).sort((a, b) => a.data.username.localeCompare(b.data.username));
    
    // Pagination constants
    const USERS_PER_PAGE = 10;
    const totalPages = Math.ceil(allUsers.length / USERS_PER_PAGE);
    const currentPage = ctx.session.userPage;
    
    // Calculate start and end indices
    const startIndex = currentPage * USERS_PER_PAGE;
    const endIndex = Math.min(startIndex + USERS_PER_PAGE, allUsers.length);
    const usersToShow = allUsers.slice(startIndex, endIndex);
    
    // Build message text
    let text = `👥 *All Users* (Page ${currentPage + 1}/${totalPages})\n\n`;
    const buttons = [];
    
    usersToShow.forEach(user => {
      const data = user.data;
      let status = '❓'; // Unknown status
      if (data.approved && data.licenseActive) status = '✅'; // Active
      else if (data.approved && !data.licenseActive) status = '⏸️'; // Approved but inactive
      else if (data.licenseType === 'rejected') status = '❌'; // Rejected
      else if (!data.approved) status = '⏳'; // Pending approval
      
      text += `${status} ${data.username} (${data.email})\n`;
      buttons.push([Markup.button.callback(
        `Manage: ${data.username}`,
        `manage:${data.email}`
      )]);
    });
    
    // Pagination buttons
    const paginationButtons = [];
    
    if (currentPage > 0) {
      paginationButtons.push(Markup.button.callback('⬅️ Previous', 'prev_users'));
    }
    
    if (endIndex < allUsers.length) {
      paginationButtons.push(Markup.button.callback('Next ➡️', 'next_users'));
    }
    
    buttons.push(paginationButtons);
    buttons.push([Markup.button.callback('🔙 Back', 'menu')]);
    
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
  
  if (ctx.session.userPage > 0) {
    ctx.session.userPage--;
  }
  
  // Refresh the users list by calling the users action again
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
  
  // Get total users to calculate max pages
  const snapshot = await getDocs(collection(db, 'users'));
  const totalUsers = snapshot.size;
  const USERS_PER_PAGE = 10;
  const totalPages = Math.ceil(totalUsers / USERS_PER_PAGE);
  
  if (ctx.session.userPage < totalPages - 1) {
    ctx.session.userPage++;
  }
  
  // Refresh the users list by calling the users action again
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
      
      let status = '❓';
      if (data.approved && data.licenseActive) status = '✅ Approved & Active';
      else if (data.approved && !data.licenseActive) status = '⏸️ Approved & Inactive';
      else if (data.licenseType === 'rejected') status = '❌ Rejected';
      else if (!data.approved) status = '⏳ Pending Approval';
      
      const license = data.licenseActive ? '🟢 Active' : '🔴 Inactive';
      
      ctx.editMessageText(
        `👤 *User Details*\n\n` +
        `📝 Username: ${data.username}\n` +
        `📛 Name: ${data.name}\n` +
        `📧 Email: \`${data.email}\`\n` +
        `📊 Status: ${status}\n` +
        `🔑 License: ${license}\n` +
        `📅 Expires: ${data.licenseExpiresAt ? new Date(data.licenseExpiresAt).toLocaleDateString() : 'N/A'}\n` +
        `🔐 Device ID: \`${data.deviceId || 'Not bound'}\``,
        { parse_mode: 'Markdown', ...userActionButtons(email) }
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
        approved: true, // Approve the user
        licenseActive: true,
        licenseExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        // Note: deviceId is not cleared here - use unbind feature separately
      });
      
      // Log admin action
      await addDoc(collection(db, 'adminLogs'), {
        action: 'activate',
        email,
        adminId: ctx.from.id,
        adminUsername: ctx.from.username || 'unknown',
        timestamp: new Date().toISOString()
      });
      
      ctx.reply(`✅ License activated for ${email}`);
    }
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// Deactivate license - FIXED: Correct message
bot.action(/deactivate:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  const email = ctx.match[1];
  
  try {
    const userDocRef = doc(db, 'users', email);
    const userDocSnap = await getDoc(userDocRef);
    
    if (userDocSnap.exists()) {
      await updateDoc(doc(db, 'users', userDocSnap.id), {
        licenseActive: false
        // Note: deviceId is not cleared here - use unbind feature separately
      });
      
      // Log admin action
      await addDoc(collection(db, 'adminLogs'), {
        action: 'deactivate',
        email,
        adminId: ctx.from.id,
        adminUsername: ctx.from.username || 'unknown',
        timestamp: new Date().toISOString()
      });
      
      ctx.reply(`🛑 License deactivated for ${email}`);
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
      
      // Log admin action
      await addDoc(collection(db, 'adminLogs'), {
        action: 'unbind',
        email,
        adminId: ctx.from.id,
        adminUsername: ctx.from.username || 'unknown',
        timestamp: new Date().toISOString()
      });
      
      ctx.reply(`🔓 Device unbound for ${email}`);
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
  
  // Note: In production, use Firebase Admin SDK to reset password
  ctx.reply(
    `🔑 *Password Reset*\n\n` +
    `Email: \`${email}\`\n` +
    `Temp Password: \`${tempPassword}\`\n\n` +
    `⚠️ Note: You need to manually update this in Firebase Auth console.`,
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
      
      // Log admin action
      await addDoc(collection(db, 'adminLogs'), {
        action: 'change_validity',
        email,
        days,
        adminId: ctx.from.id,
        adminUsername: ctx.from.username || 'unknown',
        timestamp: new Date().toISOString()
      });
      
      ctx.reply(`✅ Validity updated for ${email}: ${days === -1 ? 'Lifetime' : days + ' days'}`);
    }
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// Back to menu
bot.action('menu', (ctx) => {
  if (!isAdmin(ctx)) return adminOnly(ctx);
  
  ctx.editMessageText(
    '🔐 *Admin Panel - Redeem Bot V3*\n\n' +
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
      `📊 *Statistics*\n\n` +
      `👥 Total Users: ${total}\n` +
      `✅ Approved: ${approved}\n` +
      `🟢 Active Licenses: ${active}\n` +
      `❌ Rejected: ${rejected}\n` +
      `⏳ Pending Approvals: ${pendingSnapshot.size}`,
      { parse_mode: 'Markdown', ...mainMenu }
    );
  } catch (error) {
    ctx.reply('Error: ' + error.message);
  }
});

// ==================== REAL-TIME NOTIFICATIONS ====================

// Listen for new registrations
function startNotifications() {
  const q = collection(db, 'pendingApprovals');
  
  onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const data = change.doc.data();
        
        // Send notification to admin
        bot.telegram.sendMessage(
          ADMIN_ID,
          formatUserData(data) + '\n\nUse /pending to approve/reject.',
          { 
            parse_mode: 'Markdown',
            ...approvalButtons(data.email)
          }
        );
      }
    });
  });
  
  console.log('🔔 Notifications started');
}

// ==================== ERROR HANDLING ====================

// Global error handler
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  // Ignore "message not modified" errors
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
          // Expire the license
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
setInterval(autoExpireLicenses, 3600000); // 1 hour

// Keep-alive function to ping itself (for free tier)
function keepAlive() {
  const url = `https://${process.env.RENDER_EXTERNAL_URL || 'your-app-name.onrender.com'}`;
  fetch(url)
    .then(res => console.log(`Keep alive ping: ${res.status}`))
    .catch(err => console.log(`Keep alive error: ${err.message}`));
}

// Ping every 10 minutes to keep the service awake
if (process.env.NODE_ENV === 'production') {
  setInterval(keepAlive, 600000); // 10 minutes
}

// ==================== START BOT ====================

// Use webhook instead of polling for Render free tier
const webhookPath = `/bot${BOT_TOKEN}`;

expressApp.use(bot.webhookCallback(webhookPath));

bot.telegram.setWebhook(
  `${process.env.RENDER_EXTERNAL_URL}${webhookPath}`
);

console.log("🤖 Webhook Bot Started!");
startNotifications();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
