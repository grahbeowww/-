import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('verification')
    .setDescription('Publie le panneau de vérification dans le serveur.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option.setName('salon')
        .setDescription('Le salon où publier le panneau, par exemple #rules.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Le rôle donné après vérification, par exemple Vérifié.')
        .setRequired(true)),
  async execute(interaction) {
    const channel = interaction.options.getChannel('salon', true);
    const role = interaction.options.getRole('role', true);

    if (!interaction.guild || !channel.isTextBased()) {
      return interaction.reply({ content: 'Cette commande doit être utilisée dans un serveur et un salon textuel.', ephemeral: true });
    }

    const botMember = interaction.guild.members.me;
    if (!botMember?.permissionsIn(channel).has(PermissionFlagsBits.SendMessages) ||
        !botMember.permissionsIn(channel).has(PermissionFlagsBits.EmbedLinks)) {
      return interaction.reply({ content: 'Il me faut les permissions **Envoyer des messages** et **Intégrer des liens** dans ce salon.', ephemeral: true });
    }
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: 'Il me manque la permission **Gérer les rôles**.', ephemeral: true });
    }
    if (role.managed || role.position >= botMember.roles.highest.position) {
      return interaction.reply({ content: 'Je ne peux pas attribuer ce rôle : place mon rôle au-dessus du rôle choisi dans **Paramètres du serveur → Rôles**.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🛡️ Vérification du serveur')
      .setDescription(
        'Bienvenue sur le serveur ! 👋\n\n' +
        'Pour accéder aux salons et discuter avec tout le monde, lis le règlement puis clique sur le bouton ci-dessous. ' +
        'Tu recevras automatiquement le rôle **' + role.name + '**.\n\n' +
        '✅ Clique sur **Je suis vérifié** pour accéder au serveur.'
      )
      .setFooter({ text: 'Dante • Vérification' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verification:' + role.id)
        .setLabel('Je suis vérifié')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
    );

    await channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: '✅ Panneau de vérification publié dans ' + channel.toString() + ' avec le rôle **' + role.name + '**.', ephemeral: true });
  },
};
