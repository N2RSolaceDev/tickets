require('dotenv').config();
const express = require('express');
const app = express();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');

// Initialize client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers
  ]
});

// Load environment variables
const {
  TOKEN,
  TICKET_SETUP_CHANNEL_ID,
  SUPPORT_ROLE_ID,
  OWNER_ROLE_ID,
  WELCOME_ROLE_ID,
  WELCOME_CHANNEL_ID,
  PORT
} = process.env;

// Store active user tickets
const userTickets = new Map(); // { userId => channelId }

// Store category IDs by type
const ticketCategories = {
  join_team: null,
  support: null,
  contact_owner: null
};

// Ensure categories exist or create them
async function ensureCategories(guild) {
  const categoriesToCreate = [
    { name: 'Join Team Tickets', key: 'join_team' },
    { name: 'Support Tickets', key: 'support' },
    { name: 'Contact Owner Tickets', key: 'contact_owner' }
  ];

  for (const { name, key } of categoriesToCreate) {
    let category = guild.channels.cache.find(
      ch =>
        ch.type === ChannelType.GuildCategory &&
        ch.name.toLowerCase() === name.toLowerCase()
    );

    if (!category) {
      try {
        category = await guild.channels.create({
          name,
          type: ChannelType.GuildCategory
        });
        console.log(`✅ Created category: ${name}`);
      } catch (err) {
        console.error(`❌ Could not create category "${name}"`, err.message);
        continue;
      }
    }

    ticketCategories[key] = category.id;
  }
}

client.once('ready', async () => {
  console.log(`🟢 Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.first();
  if (!guild) return console.error('Bot must be in at least one server.');

  // Ensure all categories exist
  await ensureCategories(guild);

  // Setup ticket panel
  const setupChannel = client.channels.cache.get(TICKET_SETUP_CHANNEL_ID);
  if (!setupChannel || setupChannel.type !== ChannelType.GuildText) {
    return console.error('Ticket setup channel not found.');
  }

  // Remove existing panels
  const fetched = await setupChannel.messages.fetch({ limit: 10 });
  const oldPanel = fetched.find(
    msg => msg.author.id === client.user.id && msg.embeds[0]?.title === '🎫 Open a Ticket'
  );
  if (oldPanel) await oldPanel.delete().catch(console.error);

  // Create embed with description and image
  const embed = new EmbedBuilder()
    .setTitle('**Team Saki**')
    .setDescription(`is a multimedia organisation that specialises in content production and competitive esports. It was established in 2025 in hopes of redefining the standards of professional gaming. Team Saki aims to become a leading force in the global gaming scene, showing dedication to developing talent, producing quality content, and building a connected community of fans and talent.\n\n**Would you like to join?**`)
    .setColor('#0099ff')
    .setImage('attachment://saki.png'); // Show image before buttons

  // Buttons for each ticket type
  const joinTeamButton = new ButtonBuilder()
    .setCustomId('ticket-join_team')
    .setLabel('Join Team')
    .setEmoji('👥')
    .setStyle(ButtonStyle.Primary);

  const supportButton = new ButtonBuilder()
    .setCustomId('ticket-support')
    .setLabel('Support')
    .setEmoji('🛠')
    .setStyle(ButtonStyle.Secondary);

  const contactOwnerButton = new ButtonBuilder()
    .setCustomId('ticket-contact_owner')
    .setLabel('Contact Owner')
    .setEmoji('👑')
    .setStyle(ButtonStyle.Danger);

  const row1 = new ActionRowBuilder().addComponents(joinTeamButton, supportButton);
  const row2 = new ActionRowBuilder().addComponents(contactOwnerButton);

  // Send ticket panel
  await setupChannel.send({
    embeds: [embed],
    components: [row1, row2],
    files: ['./saki.png'] // Attach local image
  });

  console.log('🎟️ Ticket panel with buttons successfully sent!');
});

// Unified interaction handler
client.on('interactionCreate', async interaction => {
  // Handle ticket buttons
  if (
    interaction.isButton() &&
    ['ticket-join_team', 'ticket-support', 'ticket-contact_owner'].includes(interaction.customId)
  ) {
    const selected = interaction.customId.replace('ticket-', '');
    const user = interaction.user;
    const guild = interaction.guild;

    // Optional: Allow only one ticket per user
    if (userTickets.has(user.id)) {
      return interaction.reply({
        content: 'You already have an open ticket!',
        ephemeral: true
      });
    }

    // Re-check category existence every time
    let category = guild.channels.cache.get(ticketCategories[selected]);
    if (!category || category.type !== ChannelType.GuildCategory) {
      try {
        await ensureCategories(guild); // Refresh category list
        category = guild.channels.cache.get(ticketCategories[selected]);
        if (!category) throw new Error('Category not found after refresh');
      } catch (err) {
        console.error('Failed to re-ensure category:', err);
        return interaction.reply({
          content: 'Could not find or recreate the ticket category.',
          ephemeral: true
        });
      }
    }

    const categoryId = category.id;
    let allowedRoleId;

    switch (selected) {
      case 'join_team':
      case 'support':
        allowedRoleId = SUPPORT_ROLE_ID;
        break;
      case 'contact_owner':
        allowedRoleId = OWNER_ROLE_ID;
        break;
    }

    const everyoneRole = guild.roles.everyone;
    const safeUsername = user.username.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const ticketName = `${selected}-${safeUsername}`;

    try {
      const ticketChannel = await guild.channels.create({
        name: ticketName,
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: [
          {
            id: everyoneRole.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
          },
          {
            id: allowedRoleId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
          },
          {
            id: OWNER_ROLE_ID,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
          }
        ]
      });

      const embed = new EmbedBuilder()
        .setTitle(`📬 Ticket opened by ${user.username}`)
        .setDescription(`Hello ${user}, a staff member will assist you shortly.\n**Type:** ${selected.replace('_', ' ')}`)
        .setColor('#2ecc71')
        .setTimestamp();

      const closeButton = new ButtonBuilder()
        .setCustomId('close-ticket')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(closeButton);

      await ticketChannel.send({ embeds: [embed], components: [row] });
      userTickets.set(user.id, ticketChannel.id);

      await interaction.reply({
        content: `✅ Your ticket has been created: <#${ticketChannel.id}>`,
        ephemeral: true
      });
    } catch (err) {
      console.error('Error creating ticket channel:', err.message);
      await interaction.reply({
        content: '❌ Failed to create ticket channel. Please try again later.',
        ephemeral: true
      });
    }
  }

  // Handle close button
  if (interaction.isButton() && interaction.customId === 'close-ticket') {
    const channel = interaction.channel;

    if (!channel.parentId) {
      return interaction.reply({
        content: 'This command can only be used inside a ticket.',
        ephemeral: true
      });
    }

    const ownerIdMatch = channel.name.match(/-(.+)/);
    if (ownerIdMatch && ownerIdMatch[1]) {
      const ownerId = ownerIdMatch[1];
      const guildMember = await channel.guild.members.fetch(ownerId).catch(() => null);
      if (guildMember) {
        await guildMember.send(`✅ Your ticket (**${channel.name}**) has been closed.`).catch(() => {});
      }
    }

    // Remove from map
    for (const [userId, channelId] of userTickets.entries()) {
      if (channelId === channel.id) {
        userTickets.delete(userId);
        break;
      }
    }

    await interaction.reply({
      content: '✅ Closing this ticket...',
      ephemeral: true
    });

    setTimeout(async () => {
      await channel.delete();
    }, 2000);
  }
});

// Auto role & welcome message
client.on('guildMemberAdd', async member => {
  const roleId = WELCOME_ROLE_ID;
  const welcomeChannelId = WELCOME_CHANNEL_ID;

  try {
    await member.roles.add(roleId);
  } catch (err) {
    console.error('Error assigning role:', err.message);
  }

  const welcomeChannel = client.channels.cache.get(welcomeChannelId);
  if (welcomeChannel?.isTextBased()) {
    const embed = new EmbedBuilder()
      .setTitle('🎉 Welcome to the Server!')
      .setDescription(`Welcome <@${member.id}> to the server!\nWe're glad to have you here.`)
      .setColor('#00FF00')
      .setThumbnail(member.displayAvatarURL({ dynamic: true }));

    await welcomeChannel.send({ embeds: [embed] });
  }
});

// Start Express server
app.get('/', (req, res) => {
  res.status(200).send('Discord bot is running!');
});
app.listen(PORT, () => {
  console.log(`🌐 Web server is running on port ${PORT}`);
});

// Login
client.login(TOKEN);