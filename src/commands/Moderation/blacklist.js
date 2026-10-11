import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';

const BLACKLIST_KEY = (guildId) => `moderation:blacklist:${guildId}`;

function unwrapStoredValue(value) {
    if (value && typeof value === 'object' && 'value' in value && !('entries' in value)) {
        return value.value;
    }
    return value;
}

async function readBlacklist(client, guildId) {
    const stored = await client.db.get(BLACKLIST_KEY(guildId));
    const data = unwrapStoredValue(stored);
    return {
        guildId,
        entries: data?.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)
            ? { ...data.entries }
            : {},
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Gérer la blacklist permanente du serveur')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Blacklister et bannir définitivement un utilisateur')
                .addUserOption(option =>
                    option.setName('membre')
                        .setDescription('Utilisateur à blacklister')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('raison')
                        .setDescription('Raison du blacklist')
                        .setMaxLength(500)
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Retirer un utilisateur de la blacklist et le débannir')
                .addUserOption(option =>
                    option.setName('membre')
                        .setDescription('Utilisateur à retirer')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Afficher les utilisateurs blacklistés')),

    async execute(interaction, _config, client) {
        const guild = interaction.guild;
        if (!guild) {
            return interaction.reply({ content: 'Cette commande doit être utilisée dans un serveur.', ephemeral: true });
        }

        const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        if (!botMember?.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ content: 'Il me manque la permission **Bannir des membres**.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        const blacklist = await readBlacklist(client, guild.id);

        if (subcommand === 'list') {
            const entries = Object.values(blacklist.entries)
                .sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
            if (entries.length === 0) {
                return interaction.reply({ content: '✅ La blacklist est vide.', ephemeral: true });
            }

            const lines = entries.slice(0, 20).map(entry =>
                `• <@${entry.userId}> — ${String(entry.reason || 'Aucune raison').slice(0, 120)}`
            );
            const description = lines.join('\n') + (entries.length > 20 ? `\n… et ${entries.length - 20} autre(s).` : '');
            const embed = new EmbedBuilder()
                .setColor(0xc0392b)
                .setTitle(`🚫 Blacklist du serveur (${entries.length})`)
                .setDescription(description)
                .setFooter({ text: 'Dante • Modération' });
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const target = interaction.options.getUser('membre', true);
        if (target.id === guild.ownerId) {
            return interaction.reply({ content: 'Le propriétaire du serveur ne peut pas être blacklisté.', ephemeral: true });
        }

        if (subcommand === 'add') {
            if (target.id === interaction.user.id || target.id === client.user.id) {
                return interaction.reply({ content: 'Tu ne peux pas te blacklister toi-même ni blacklister Dante.', ephemeral: true });
            }
            if (blacklist.entries[target.id]) {
                return interaction.reply({ content: `⚠️ <@${target.id}> est déjà dans la blacklist.`, ephemeral: true });
            }

            const reason = interaction.options.getString('raison') || 'Aucune raison indiquée';
            const previousEntries = { ...blacklist.entries };
            blacklist.entries[target.id] = {
                userId: target.id,
                tag: target.tag,
                reason,
                moderatorId: interaction.user.id,
                addedAt: new Date().toISOString(),
            };

            await interaction.deferReply({ ephemeral: true });
            await client.db.set(BLACKLIST_KEY(guild.id), blacklist);

            try {
                const alreadyBanned = await guild.bans.fetch({ user: target.id }).catch(() => null);
                let caseId = null;
                if (!alreadyBanned) {
                    const result = await ModerationService.banUser({
                        guild,
                        user: target,
                        moderator: interaction.member,
                        reason: `Blacklist : ${reason}`,
                    });
                    caseId = result?.caseId ?? null;
                }

                const suffix = caseId ? `\n**Dossier :** #${caseId}` : '';
                return await InteractionHelper.safeEditReply(interaction, {
                    content: `🚫 <@${target.id}> a été ajouté à la blacklist et banni du serveur.\n**Raison :** ${reason}${suffix}`,
                });
            } catch (error) {
                blacklist.entries = previousEntries;
                if (Object.keys(previousEntries).length > 0) {
                    await client.db.set(BLACKLIST_KEY(guild.id), blacklist).catch(() => {});
                } else {
                    await client.db.delete(BLACKLIST_KEY(guild.id)).catch(() => {});
                }
                throw error;
            }
        }

        if (subcommand === 'remove') {
            if (!blacklist.entries[target.id]) {
                return interaction.reply({ content: `<@${target.id}> n'est pas dans la blacklist.`, ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            const ban = await guild.bans.fetch({ user: target.id }).catch(() => null);
            if (ban) {
                await ModerationService.unbanUser({
                    guild,
                    user: target,
                    moderator: interaction.member,
                    reason: 'Retrait de la blacklist par un modérateur',
                });
            }

            delete blacklist.entries[target.id];
            if (Object.keys(blacklist.entries).length > 0) {
                await client.db.set(BLACKLIST_KEY(guild.id), blacklist);
            } else {
                await client.db.delete(BLACKLIST_KEY(guild.id));
            }

            return InteractionHelper.safeEditReply(interaction, {
                content: `✅ <@${target.id}> a été retiré de la blacklist${ban ? ' et débanni' : ''}.`,
            });
        }

        throw new TitanBotError('Unknown blacklist subcommand', ErrorTypes.VALIDATION, 'Sous-commande blacklist inconnue.');
    },
};
