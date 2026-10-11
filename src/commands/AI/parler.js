import { SlashCommandBuilder } from 'discord.js';
import { startVoiceAssistant, stopVoiceAssistant } from '../../services/ai/voiceAssistant.js';

export default {
    category: 'AI',
    data: new SlashCommandBuilder()
        .setName('parler')
        .setDescription('Active ou arrête Dante en mode assistant vocal')
        .addStringOption(option =>
            option
                .setName('action')
                .setDescription('Démarrer ou arrêter l’assistant vocal')
                .setRequired(true)
                .addChoices(
                    { name: 'Démarrer', value: 'start' },
                    { name: 'Arrêter', value: 'stop' },
                ),
        ),

    async execute(interaction, config, client) {
        const action = interaction.options.getString('action');
        if (action === 'stop') {
            const stopped = stopVoiceAssistant(interaction.guildId);
            await interaction.reply({
                content: stopped ? 'Je quitte le vocal. À plus !' : 'Je ne suis pas en mode assistant vocal.',
                ephemeral: true,
            });
            return;
        }

        const channel = interaction.member?.voice?.channel;
        if (!channel) {
            await interaction.reply({
                content: 'Rejoins un salon vocal Discord avant de lancer Dante.',
                ephemeral: true,
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });
        try {
            await startVoiceAssistant(interaction.guild, channel, client.user.id);
            await interaction.editReply('Dante écoute maintenant dans ce salon. Parle normalement ; utilise /parler avec l’action Arrêter pour arrêter.');
        } catch (error) {
            console.error('[Dante voice] Impossible de démarrer:', error);
            await interaction.editReply(
                error.message === 'OPENAI_API_KEY est absente.'
                    ? 'La variable OPENAI_API_KEY manque dans Railway.'
                    : 'Je n’arrive pas à rejoindre ou démarrer le vocal. Vérifie les logs Railway.',
            );
        }
    },
};
