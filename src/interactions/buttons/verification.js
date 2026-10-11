import { PermissionFlagsBits } from 'discord.js';

export default {
  name: 'verification',
  async execute(interaction, client, args = []) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({ content: 'La vérification fonctionne uniquement dans le serveur.', ephemeral: true });
    }

    const roleId = args[0];
    if (!roleId || !/^\d{17,20}$/.test(roleId)) {
      return interaction.reply({ content: 'Ce panneau de vérification est invalide. Demande à un membre du staff de le republier avec /verification.', ephemeral: true });
    }

    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      return interaction.reply({ content: 'Le rôle de vérification n’existe plus. Préviens le staff.', ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: 'Je n’arrive pas à retrouver ton membre sur le serveur. Réessaie dans un instant.', ephemeral: true });
    }

    if (member.roles.cache.has(role.id)) {
      return interaction.reply({ content: '✅ Tu es déjà vérifié, frérot !', ephemeral: true });
    }

    const botMember = interaction.guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles) ||
        role.managed || role.position >= botMember.roles.highest.position) {
      return interaction.reply({ content: 'Je ne peux pas attribuer ce rôle pour le moment. Le staff doit vérifier ma permission **Gérer les rôles** et placer mon rôle au-dessus de **' + role.name + '**.', ephemeral: true });
    }

    try {
      await member.roles.add(role, 'Membre ayant cliqué sur le bouton de vérification Dante');
      return interaction.reply({ content: '✅ C’est bon frérot, tu es vérifié ! Bienvenue sur le serveur 🎉', ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: 'Je n’ai pas réussi à te donner le rôle. Préviens le staff pour vérifier mes permissions.', ephemeral: true }).catch(() => {});
    }
  },
};
