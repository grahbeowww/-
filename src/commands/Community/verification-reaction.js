import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';

const CONFIG_PREFIX = 'verification:reaction:';
const DANGEROUS_ROLE_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.MentionEveryone,
];

export default {
  data: new SlashCommandBuilder()
    .setName('verification-reaction')
    .setDescription('Publie les règles avec une réaction ✅ pour recevoir le rôle Vérifié.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option
        .setName('salon')
        .setDescription('Salon où publier le message, par exemple #rules.')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true))
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Rôle donné après acceptation, par exemple Vérifié.')
        .setRequired(true)),

  async execute(interaction, _guildConfig, client) {
    const channel = interaction.options.getChannel('salon', true);
    const role = interaction.options.getRole('role', true);
    const guild = interaction.guild;

    if (!guild || !channel.isTextBased()) {
      return interaction.reply({
        content: 'Cette commande doit être utilisée dans un serveur avec un salon textuel.',
        ephemeral: true,
      });
    }

    const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!botMember) {
      return interaction.reply({
        content: 'Je n’arrive pas à vérifier mes permissions. Réessaie dans un instant.',
        ephemeral: true,
      });
    }

    const channelPermissions = channel.permissionsFor(botMember);
    const requiredChannelPermissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.ReadMessageHistory,
    ];
    if (!channelPermissions?.has(requiredChannelPermissions)) {
      return interaction.reply({
        content: 'Dans ce salon, il me faut **Voir le salon**, **Envoyer des messages**, **Intégrer des liens**, **Ajouter des réactions** et **Lire l’historique des messages**.',
        ephemeral: true,
      });
    }

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: 'Il me manque la permission **Gérer les rôles**.',
        ephemeral: true,
      });
    }

    if (role.id === guild.id || role.managed ||
        role.position >= botMember.roles.highest.position ||
        DANGEROUS_ROLE_PERMISSIONS.some(permission => role.permissions.has(permission))) {
      return interaction.reply({
        content: 'Je ne peux pas attribuer ce rôle. Choisis un rôle classique, sans permissions dangereuses, et place mon rôle au-dessus de **' + role.name + '** dans **Paramètres du serveur → Rôles**.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    let message;
    const configKey = `${CONFIG_PREFIX}${guild.id}:${Date.now()}:${interaction.id}`;
    try {
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🛡️ Vérification du serveur')
        .setDescription(
          'Bienvenue sur le serveur ! 👋\n\n' +
          'Lis le règlement ci-dessus, puis **réagis avec ✅ à ce message pour confirmer que tu l’acceptes**.\n\n' +
          'Le rôle **' + role.name + '** te sera automatiquement attribué et tu pourras accéder aux salons réservés aux membres vérifiés.'
        )
        .setFooter({ text: 'Dante • Réagis avec ✅ pour accepter le règlement' });

      message = await channel.send({ embeds: [embed] });

      await client.db.set(`${CONFIG_PREFIX}${guild.id}:${message.id}`, {
        guildId: guild.id,
        channelId: channel.id,
        messageId: message.id,
        roleId: role.id,
      });

      await message.react('✅');

      return interaction.editReply({
        content: '✅ C’est publié dans ' + channel.toString() + ' ! Les membres devront réagir avec ✅ pour recevoir le rôle **' + role.name + '**.',
      });
    } catch (error) {
      if (message) {
        await client.db.delete(`${CONFIG_PREFIX}${guild.id}:${message.id}`).catch(() => {});
        await message.delete().catch(() => {});
      }
      return interaction.editReply({
        content: '❌ Je n’ai pas réussi à publier le message de vérification. Vérifie mes permissions dans ce salon et réessaie.',
      }).catch(() => {});
    }
  },
};
