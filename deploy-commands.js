require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('createaccount')
    .setDescription('Create your download account (requires Gamepass)')
    .addStringOption(o => o.setName('username').setDescription('Choose a username').setRequired(true))
    .addStringOption(o => o.setName('password').setDescription('Choose a password').setRequired(true))
    .addStringOption(o => o.setName('robloxusername').setDescription('Your Roblox username (to check Gamepass)').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('download')
    .setDescription('Login and get a link to the website')
    .addStringOption(o => o.setName('username').setDescription('Your username').setRequired(true))
    .addStringOption(o => o.setName('password').setDescription('Your password').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('resetpassword')
    .setDescription('Reset your password using your recovery key')
    .addStringOption(o => o.setName('key').setDescription('Your recovery key').setRequired(true))
    .addStringOption(o => o.setName('newpassword').setDescription('Your new password').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('resetusername')
    .setDescription('Change your username using your recovery key')
    .addStringOption(o => o.setName('key').setDescription('Your recovery key').setRequired(true))
    .addStringOption(o => o.setName('newusername').setDescription('Your new username').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Delete a download account (Admin only)')
    .addUserOption(o => o.setName('user').setDescription('Discord user (if known)').setRequired(false))
    .addStringOption(o => o.setName('username').setDescription('Account username (if known)').setRequired(false))
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering guild commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Commands registered!');
  } catch (err) {
    console.error(err);
  }
})();
