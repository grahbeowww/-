import { Events, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';

const CONFIG_PREFIX = 'verification:reaction:';

export default {
  name: Events.MessageReactionAdd,
  once: false,

  async execute(reaction, user, client) {
    try {
      if (user.bot || reaction.emoji.name !== '✅') return;

      if (reaction.partial) {
        reaction = await reaction.fetch().catch(() => null);
        if (!reaction) return;
      }

      let message = reaction.message;
      if (message.partial) {
        message = await message.fetch().catch(() => null);
        if (!message) return;
      }

      const guild = message.guild;
      if (!guild || message.author?.id !== client.user?.id) return;

      const configKey = `${CONFIG_PREFIX}${guild.id}:${message.id}`;
      const verificationConfig = await client.db.get(configKey);
      if (
        !verificationConfig ||
        verificationConfig.guildId !== guild.id ||
        verificationConfig.messageId !== message.id ||
        !verificationConfig.roleId
      ) {
        return;
      }

      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      const role = await guild.roles.fetch(verificationConfig.roleId).catch(() => null);
      if (!role || role.managed || role.id === guild.id) {
        logger.warn(`Verification reaction points to a missing or invalid role for message ${message.id}`);
        return;
      }

      const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
      if (
        !botMember?.permissions.has(PermissionFlagsBits.ManageRoles) ||
        role.position >= botMember.roles.highest.position
      ) {
        logger.warn(`Cannot assign verification role ${role.id}; check Manage Roles and role hierarchy.`);
        return;
      }

      if (member.roles.cache.has(role.id)) return;

      await member.roles.add(role, 'Acceptation du règlement avec la réaction ✅');
      logger.info(`Verification role ${role.name} assigned to ${user.tag} in guild ${guild.id}`);
    } catch (error) {
      logger.error('Error handling verification reaction:', error);
    }
  },
};
