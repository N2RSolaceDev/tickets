// Load environment variables from .env
require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');

// Create client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
    ],
});

// Load config from environment variables
const {
    TOKEN,
    TICKET_SETUP_CHANNEL_ID,
    SUPPORT_ROLE_ID,
    OWNER_ROLE_ID
} = process.env;

// Store active user tickets
const userTickets = new Map();

// Store category IDs by type
const ticketCategories = {
    join_team: null,
    support: null,
    contact_owner: null,
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
            ch => ch.type === ChannelType.GuildCategory && ch.name.toLowerCase() === name.toLowerCase()
        );

        if (!category) {
            try {
                category = await guild.channels.create({
                    name,
                    type: ChannelType.GuildCategory,
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
    const oldPanel = fetched.find(msg =>
        msg.author.id === client.user.id &&
        msg.embeds[0]?.title === '🎫 Open a Ticket'
    );
    if (oldPanel) await oldPanel.delete().catch(console.error);

    // Create embed and dropdown
    const embed = new EmbedBuilder()
        .setTitle('🎫 Open a Ticket')
        .setDescription("Please select the type of ticket you'd like to open:")
        .setColor('#0099ff');

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ticket-menu')
        .setPlaceholder('Choose a ticket type...')
        .addOptions([
            {
                label: 'Join Team',
                description: 'Apply to join the team.',
                value: 'join_team',
                emoji: '👥',
            },
            {
                label: 'Support',
                description: 'Get help with something.',
                value: 'support',
                emoji: '🛠️',
            },
            {
                label: 'Contact Owner',
                description: 'Speak directly to management.',
                value: 'contact_owner',
                emoji: '👑',
            },
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await setupChannel.send({ embeds: [embed], components: [row] });
    console.log('🎟️ Ticket panel successfully sent!');
});

// Unified interaction handler
client.on('interactionCreate', async interaction => {
    // Handle select menu
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket-menu') {
        const selected = interaction.values[0];
        const user = interaction.user;
        const guild = interaction.guild;

        // Prevent duplicate tickets
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
                allowedRoleId = SUPPORT_ROLE_ID; // Support role
                break;
            case 'contact_owner':
                allowedRoleId = OWNER_ROLE_ID; // Owner role
                break;
        }

        const everyoneRole = guild.roles.everyone;

        // Sanitize username for channel name
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
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                    {
                        id: allowedRoleId,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                    {
                        id: OWNER_ROLE_ID, // Always allow owner role
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                ],
            });

            const embed = new EmbedBuilder()
                .setTitle(`📬 Ticket opened by ${user.username}`)
                .setDescription(`Hello ${user}, a staff member will assist you shortly.
**Type:** ${selected.replace('_', ' ')}`)
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
                content: `✅ Your ticket has been created: ${ticketChannel}`,
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

        // Try to notify user
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
    const roleId = process.env.WELCOME_ROLE_ID;
    const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;

    try {
        await member.roles.add(roleId);
    } catch (err) {
        console.error('Error assigning role:', err.message);
    }

    const welcomeChannel = client.channels.cache.get(welcomeChannelId);
    if (welcomeChannel?.isTextBased()) {
        const embed = new EmbedBuilder()
            .setTitle('🎉 Welcome to the Server!')
            .setDescription(`Welcome <@${member.id}> to the server!
We're glad to have you here.`)
            .setColor('#00FF00')
            .setThumbnail(member.displayAvatarURL({ dynamic: true }));

        await welcomeChannel.send({ embeds: [embed] });
    }
});

// Login
client.login(TOKEN);
