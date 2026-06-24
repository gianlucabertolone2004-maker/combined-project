require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { Client, GatewayIntentBits, EmbedBuilder, MessageFlags } = require('discord.js');

// ════════════════════════════════════════════════════════════════════════════
// SHARED DATABASE FILES
// ════════════════════════════════════════════════════════════════════════════
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
const FILES_FILE = path.join(__dirname, 'files.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_FILE)) return {};
  return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
}
function saveAccounts(data) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2));
}
function loadFiles() {
  if (!fs.existsSync(FILES_FILE)) return {};
  return JSON.parse(fs.readFileSync(FILES_FILE, 'utf8'));
}
function saveFiles(data) {
  fs.writeFileSync(FILES_FILE, JSON.stringify(data, null, 2));
}
function isAdmin(userId) {
  return process.env.ADMIN_IDS.split(',').map(id => id.trim()).includes(userId);
}
function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) key += '-';
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

// ════════════════════════════════════════════════════════════════════════════
// ROBLOX API
// ════════════════════════════════════════════════════════════════════════════
async function getRobloxUserId(username) {
  const res = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
  });
  const data = await res.json();
  if (!data.data || data.data.length === 0) return null;
  return data.data[0].id;
}
async function hasGamepass(robloxUserId, gamepassId) {
  const res = await fetch(`https://inventory.roblox.com/v1/users/${robloxUserId}/items/GamePass/${gamepassId}`);
  const data = await res.json();
  return data.data && data.data.length > 0;
}

// ════════════════════════════════════════════════════════════════════════════
// DISCORD BOT
// ════════════════════════════════════════════════════════════════════════════
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('ready', () => {
  console.log(`✅ Discord Bot is online as: ${client.user.tag}`);
  client.user.setActivity('/download', { type: 2 });
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ── /createaccount ────────────────────────────────────────────────────────
  if (interaction.commandName === 'createaccount') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const username = interaction.options.getString('username').trim();
    const password = interaction.options.getString('password');
    const robloxUsername = interaction.options.getString('robloxusername').trim();

    if (username.length < 3 || username.length > 20) {
      return await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Invalid Username').setDescription('Username must be between 3 and 20 characters.')] });
    }
    if (password.length < 6) {
      return await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Password too short').setDescription('Password must be at least 6 characters.')] });
    }

    const accounts = loadAccounts();
    if (accounts[username.toLowerCase()]) {
      return await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Username Taken').setDescription('This username already exists.')] });
    }

    const robloxUserId = await getRobloxUserId(robloxUsername);
    if (!robloxUserId) {
      return await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Roblox User Not Found').setDescription(`The username **${robloxUsername}** does not exist on Roblox.`)] });
    }

    const ownsPass = await hasGamepass(robloxUserId, process.env.ROBLOX_GAMEPASS_ID);
    if (!ownsPass) {
      return await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle('⚠️ Gamepass Required').setDescription(`**${robloxUsername}** does not own the required Gamepass.`)
          .addFields({ name: 'Gamepass ID', value: `\`${process.env.ROBLOX_GAMEPASS_ID}\``, inline: true })]
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const recoveryKey = generateKey();
    const hashedKey = await bcrypt.hash(recoveryKey, 10);

    accounts[username.toLowerCase()] = {
      username, password: hashedPassword, recoveryKey: hashedKey,
      discordId: interaction.user.id, robloxUsername, robloxUserId,
      createdAt: new Date().toISOString()
    };
    saveAccounts(accounts);

    try {
      await interaction.user.send({
        embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle('🔑 Your Recovery Key')
          .setDescription(`Save this key somewhere safe!\n\n\`\`\`${recoveryKey}\`\`\``)
          .setFooter({ text: 'Never share this key with anyone!' })]
      });
    } catch {}

    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Account Created!')
        .setDescription('Your account has been created! You can now log in on the website or use `/download`.\n\n📬 Check your DMs for your recovery key!')
        .addFields({ name: 'Username', value: username, inline: true })]
    });
  }

  // ── /download ──────────────────────────────────────────────────────────────
  if (interaction.commandName === 'download') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const username = interaction.options.getString('username').trim().toLowerCase();
    const password = interaction.options.getString('password');

    const accounts = loadAccounts();
    const account = accounts[username];

    if (!account || !(await bcrypt.compare(password, account.password))) {
      return await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Invalid Login').setDescription('Username or password is incorrect.')] });
    }

    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Login Successful!')
        .setDescription(`Go to the website to upload and download files:\n\n${process.env.WEBSITE_URL || 'Website not configured'}`)]
    });
  }

  // ── /resetpassword ────────────────────────────────────────────────────────
  if (interaction.commandName === 'resetpassword') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const key = interaction.options.getString('key').trim();
    const newPassword = interaction.options.getString('newpassword');

    if (newPassword.length < 6) {
      return await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Password too short')] });
    }

    const accounts = loadAccounts();
    let foundKey = null;
    for (const [accKey, acc] of Object.entries(accounts)) {
      if (!acc.recoveryKey) continue;
      if (await bcrypt.compare(key, acc.recoveryKey)) { foundKey = accKey; break; }
    }

    if (!foundKey) {
      return await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Invalid Key')] });
    }

    accounts[foundKey].password = await bcrypt.hash(newPassword, 10);
    saveAccounts(accounts);
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Password Reset!')] });
  }

  // ── /resetusername ────────────────────────────────────────────────────────
  if (interaction.commandName === 'resetusername') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const key = interaction.options.getString('key').trim();
    const newUsername = interaction.options.getString('newusername').trim();

    if (newUsername.length < 3 || newUsername.length > 20) {
      return await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Invalid Username')] });
    }

    const accounts = loadAccounts();
    let foundKey = null;
    for (const [accKey, acc] of Object.entries(accounts)) {
      if (!acc.recoveryKey) continue;
      if (await bcrypt.compare(key, acc.recoveryKey)) { foundKey = accKey; break; }
    }

    if (!foundKey) {
      return await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Invalid Key')] });
    }

    const newKey = newUsername.toLowerCase();
    if (accounts[newKey] && newKey !== foundKey) {
      return await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Username Taken')] });
    }

    const accountData = accounts[foundKey];
    accountData.username = newUsername;
    delete accounts[foundKey];
    accounts[newKey] = accountData;
    saveAccounts(accounts);

    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Username Changed!').setDescription(`Changed to **${newUsername}**.`)] });
  }

  // ── /ban ───────────────────────────────────────────────────────────────────
  if (interaction.commandName === 'ban') {
    if (!isAdmin(interaction.user.id)) {
      return await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ No Permission')], flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.options.getUser('user');
    const targetUsername = interaction.options.getString('username');
    if (!targetUser && !targetUsername) {
      return await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Missing Info')] });
    }

    const accounts = loadAccounts();
    let foundKey = null;
    if (targetUsername) {
      const k = targetUsername.toLowerCase().trim();
      if (accounts[k]) foundKey = k;
    } else if (targetUser) {
      foundKey = Object.keys(accounts).find(k => accounts[k].discordId === targetUser.id);
    }

    if (!foundKey) {
      return await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Account Not Found')] });
    }

    const deletedAccount = accounts[foundKey];
    delete accounts[foundKey];
    saveAccounts(accounts);

    try {
      const userToNotify = await client.users.fetch(deletedAccount.discordId);
      await userToNotify.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🚫 Account Deleted').setDescription('Your account has been deleted by an administrator.')] });
    } catch {}

    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Account Deleted')
        .addFields({ name: 'Username', value: deletedAccount.username, inline: true }, { name: 'Discord User', value: `<@${deletedAccount.discordId}>`, inline: true })]
    });
  }
});

client.login(process.env.DISCORD_TOKEN);

// ════════════════════════════════════════════════════════════════════════════
// WEBSITE (Express)
// ════════════════════════════════════════════════════════════════════════════
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

function requireLogin(req, res, next) {
  if (!req.session.username) return res.redirect('/login');
  next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

app.get('/', (req, res) => {
  if (req.session.username) return res.redirect('/dashboard');
  res.redirect('/login');
});
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/dashboard', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, message: 'Please fill in all fields.' });

  const accounts = loadAccounts();
  const account = accounts[username.toLowerCase().trim()];
  if (!account) return res.json({ success: false, message: 'Username or password is incorrect.' });

  const match = await bcrypt.compare(password, account.password);
  if (!match) return res.json({ success: false, message: 'Username or password is incorrect.' });

  req.session.username = account.username;
  req.session.userKey = username.toLowerCase().trim();
  res.json({ success: true });
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ success: true })); });
app.get('/api/me', (req, res) => {
  if (!req.session.username) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, username: req.session.username });
});

app.post('/api/upload', requireLogin, upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ success: false, message: 'No file uploaded.' });
  const files = loadFiles();
  const fileId = path.parse(req.file.filename).name;
  files[fileId] = { originalName: req.file.originalname, storedName: req.file.filename, size: req.file.size, uploadedBy: req.session.userKey, uploadedAt: new Date().toISOString() };
  saveFiles(files);
  const downloadLink = `${req.protocol}://${req.get('host')}/d/${fileId}`;
  res.json({ success: true, link: downloadLink, filename: req.file.originalname });
});

app.get('/api/myfiles', requireLogin, (req, res) => {
  const files = loadFiles();
  const myFiles = Object.entries(files).filter(([id, f]) => f.uploadedBy === req.session.userKey)
    .map(([id, f]) => ({ id, name: f.originalName, size: f.size, uploadedAt: f.uploadedAt, link: `${req.protocol}://${req.get('host')}/d/${id}` }))
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  res.json({ files: myFiles });
});

app.delete('/api/files/:id', requireLogin, (req, res) => {
  const files = loadFiles();
  const file = files[req.params.id];
  if (!file || file.uploadedBy !== req.session.userKey) return res.status(403).json({ success: false });
  const filePath = path.join(UPLOADS_DIR, file.storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  delete files[req.params.id];
  saveFiles(files);
  res.json({ success: true });
});

app.get('/d/:id', (req, res) => {
  const files = loadFiles();
  const file = files[req.params.id];
  if (!file) return res.status(404).send('File not found.');
  const filePath = path.join(UPLOADS_DIR, file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found.');
  res.download(filePath, file.originalName);
});

// ── Static Files (fixed downloads) ─────────────────────────────────────────
const STATIC_FILES = {
  'truck-fixed': { name: 'TRUCK_FIXED.rbxl', path: path.join(__dirname, 'static-files', 'TRUCK_FIXED.rbxl') },
  'my-file': { name: 'MY_FILE.rbxl', path: path.join(__dirname, 'static-files', 'MY_FILE.rbxl') }
};

app.get('/api/staticfiles', requireLogin, (req, res) => {
  const list = Object.entries(STATIC_FILES).map(([id, f]) => {
    let size = 0;
    try { size = fs.statSync(f.path).size; } catch {}
    return { id, name: f.name, size };
  });
  res.json({ files: list });
});

app.get('/download/:id', requireLogin, (req, res) => {
  const file = STATIC_FILES[req.params.id];
  if (!file || !fs.existsSync(file.path)) return res.status(404).send('File not found.');
  res.download(file.path, file.name);
});

app.listen(PORT, () => {
  console.log(`✅ Website running on port ${PORT}`);
});
