import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    EndBehaviorType,
    entersState,
    StreamType,
} from '@discordjs/voice';
import prism from 'prism-media';
import OpenAI, { toFile } from 'openai';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EdgeTTS } from 'node-edge-tts';
import ffmpegPath from 'ffmpeg-static';

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

const sessions = new Map();

function wavFromPcm(pcm, sampleRate = 48000, channels = 2) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * channels * 2, 28);
    header.writeUInt16LE(channels * 2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

function ensureFfmpegOnPath() {
    if (!ffmpegPath) return;
    const directory = ffmpegPath.slice(0, ffmpegPath.lastIndexOf('/'));
    const parts = (process.env.PATH || '').split(':');
    if (!parts.includes(directory)) {
        process.env.PATH = `${directory}:${process.env.PATH || ''}`;
    }
}

async function transcribe(pcm) {
    const file = await toFile(
        wavFromPcm(pcm),
        'discord-audio.wav',
        { type: 'audio/wav' },
    );

    const result = await groq.audio.transcriptions.create({
        model: 'whisper-large-v3',
        file,
        language: 'fr',
        prompt: 'Conversation orale spontanée en français de France entre amis sur Discord. Français familier, expressions courantes et argot. Transcris uniquement les mots réellement entendus, sans inventer de sous-titres, de musique ou de contenu de fond.',
    });

    return result.text?.trim() || '';
}

async function makeSpeech(text) {
    // Voix masculine française naturelle, sans clé API payante.
    const filePath = join(tmpdir(), `dante-${randomUUID()}.mp3`);
    try {
        const tts = new EdgeTTS({
            voice: 'fr-FR-HenriNeural',
            lang: 'fr-FR',
            outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
            rate: '-5%',
            pitch: '-2Hz',
            timeout: 15000,
        });
        await tts.ttsPromise(text, filePath);
        const audio = await readFile(filePath);
        if (!audio.length) throw new Error('La voix naturelle n’a produit aucun audio.');
        return audio;
    } finally {
        await rm(filePath, { force: true }).catch(() => {});
    }
}

async function respondAndSpeak(guildId, text, username) {
    const session = sessions.get(guildId);
    if (!session || !text) return;

    const result = await groq.chat.completions.create({
        model: 'openai/gpt-oss-20b',
        messages: [
            {
                role: 'system',
                content:
                    'Tu es Dante, un pote français sympa dans un salon vocal Discord. ' +
                    'Parle comme une vraie personne, avec un ton détendu et naturel, pas comme un assistant administratif. ' +
                    'Comprends le français familier, les abréviations et l’argot. ' +
                    'Réponds directement à ce que la personne veut dire, pas à une interprétation bizarre de ses mots. ' +
                    'Si la transcription est manifestement incohérente, demande simplement de répéter au lieu d’inventer. ' +
                    'Fais une réponse courte, généralement une seule phrase, sans listes, sans emojis, sans astérisques, ' +
                    'sans annoncer les ponctuations et sans formules toutes faites. ' +
                    'Écris des phrases fluides adaptées à une voix parlée.',
            },
            {
                role: 'user',
                content: `${username} dit : ${text}`,
            },
        ],
        max_tokens: 75,
    });

    const reply = result.choices?.[0]?.message?.content?.trim();

    if (!reply || !sessions.has(guildId)) {
        console.warn('[Dante voice] Réponse vide ou session arrêtée.');
        return;
    }

    console.log(`[Dante voice] Réponse Groq : ${reply}`);

    const audio = await makeSpeech(reply);
    if (!sessions.has(guildId)) return;

    ensureFfmpegOnPath();

    const resource = createAudioResource(
        Readable.from([audio]),
        { inputType: StreamType.Arbitrary },
    );

    session.player.stop(true);
    session.player.play(resource);

    console.log('[Dante voice] Lecture vocale locale lancée.');
}

async function captureSpeaker(guildId, userId) {
    const session = sessions.get(guildId);

    // Une seule conversation à la fois : évite les transcriptions qui se chevauchent
    // et empêche Dante de répondre à un joueur avec les paroles d'un autre.
    if (
        !session ||
        session.processing ||
        session.player.state.status === AudioPlayerStatus.Playing ||
        session.botId === userId
    ) return;

    const member = await session.guild.members
        .fetch(userId)
        .catch(() => null);

    if (!member || member.user.bot || !sessions.has(guildId)) return;

    // Verrouiller AVANT le premier await du traitement audio, pour éviter les courses.
    session.processing = true;
    session.busy.add(userId);

    try {
        const stream = session.connection.receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: 650,
            },
        });

        const decoder = new prism.opus.Decoder({
            rate: 48000,
            channels: 2,
            frameSize: 960,
        });

        const chunks = [];
        let totalBytes = 0;

        decoder.on('data', chunk => {
            if (totalBytes + chunk.length <= 48000 * 2 * 2 * 20) {
                chunks.push(chunk);
                totalBytes += chunk.length;
            }
        });

        stream.pipe(decoder);

        await Promise.race([
            once(decoder, 'end'),
            once(decoder, 'error').then(([error]) => {
                throw error;
            }),
        ]);

        const pcm = Buffer.concat(chunks);

        if (pcm.length < 48000 * 2 * 2 * 0.35) {
            console.warn(`[Dante voice] Audio trop court : ${member.displayName}.`);
            return;
        }

        console.log(`[Dante voice] Audio reçu de ${member.displayName}.`);

        const transcript = await transcribe(pcm);
        console.log(`[Dante voice] Transcription : ${transcript || '(vide)'}`);

        // Les modèles de transcription peuvent halluciner sur le silence ou le bruit.
        const normalized = transcript.toLocaleLowerCase('fr-FR').replace(/[^\p{L}\p{N} ]/gu, '').trim();
        const likelyHallucination = [
            'sous titrage societe radio canada',
            'sous titrage radio canada',
            'merci',
            'visage souriant',
        ].includes(normalized);

        if (transcript && !likelyHallucination && sessions.has(guildId)) {
            await respondAndSpeak(guildId, transcript, member.displayName);
        } else if (likelyHallucination) {
            console.warn('[Dante voice] Transcription probablement parasite ignorée.');
        }
    } catch (error) {
        console.error('[Dante voice] Erreur audio ou IA :', error);
    } finally {
        session.busy.delete(userId);
        session.processing = false;
    }
}

export async function startVoiceAssistant(guild, channel, botId) {
    if (!process.env.GROQ_API_KEY) {
        throw new Error('La variable GROQ_API_KEY est absente.');
    }

    stopVoiceAssistant(guild.id);

    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
    });

    const player = createAudioPlayer();

    player.on('error', error =>
        console.error('[Dante voice] Erreur du lecteur audio :', error),
    );

    player.on('stateChange', (oldState, newState) => {
        if (newState.status === AudioPlayerStatus.Playing) {
            console.log('[Dante voice] Dante parle.');
        }
    });

    connection.on('error', error =>
        console.error('[Dante voice] Erreur de connexion :', error),
    );

    connection.subscribe(player);

    const session = {
        guild,
        connection,
        player,
        busy: new Set(),
        processing: false,
        botId,
    };

    sessions.set(guild.id, session);

    connection.receiver.speaking.on('start', userId => {
        console.log(`[Dante voice] Parole détectée : ${userId}`);
        void captureSpeaker(guild.id, userId);
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
        stopVoiceAssistant(guild.id);
        throw error;
    }

    console.log('[Dante voice] Assistant vocal prêt.');
    return session;
}

export function stopVoiceAssistant(guildId) {
    const session = sessions.get(guildId);
    if (!session) return false;

    sessions.delete(guildId);
    session.player.stop(true);
    session.connection.destroy();

    return true;
}
