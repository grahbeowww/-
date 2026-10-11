import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, EndBehaviorType, entersState, StreamType } from '@discordjs/voice';
import prism from 'prism-media';
import OpenAI, { toFile } from 'openai';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import ffmpegPath from 'ffmpeg-static';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
    if (ffmpegPath) {
        const pathParts = (process.env.PATH || '').split(':');
        const directory = ffmpegPath.slice(0, ffmpegPath.lastIndexOf('/'));
        if (!pathParts.includes(directory)) process.env.PATH = directory + ':' + (process.env.PATH || '');
    }
}

async function transcribe(pcm) {
    const wav = wavFromPcm(pcm);
    const file = await toFile(wav, 'discord-audio.wav', { type: 'audio/wav' });
    const result = await openai.audio.transcriptions.create({
        model: 'gpt-4o-mini-transcribe',
        file,
        language: 'fr',
    });
    return result.text?.trim() || '';
}

async function respondAndSpeak(guildId, text, username) {
    const session = sessions.get(guildId);
    if (!session || !text) return;
    const answer = await openai.responses.create({
        model: 'gpt-4.1-mini',
        instructions: 'Tu es Dante, un assistant vocal Discord sympa, naturel et concis. Réponds en français, à l’oral, en 1 à 3 phrases. Tu as une voix masculine.',
        input: `${username} dit : ${text}`,
        max_output_tokens: 180,
    });
    const reply = answer.output_text?.trim();
    if (!reply || !sessions.has(guildId)) return;
    const speech = await openai.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice: 'onyx',
        response_format: 'mp3',
        input: reply,
        instructions: 'Voix masculine grave, naturelle, chaleureuse, français de France. Parle clairement et sans exagération.',
    });
    if (!sessions.has(guildId)) return;
    ensureFfmpegOnPath();
    const audio = Buffer.from(await speech.arrayBuffer());
    const resource = createAudioResource(Readable.from([audio]), { inputType: StreamType.Arbitrary });
    session.player.stop(true);
    session.player.play(resource);
}

async function captureSpeaker(guildId, userId) {
    const session = sessions.get(guildId);
    if (!session || session.busy.has(userId) || session.botId === userId) return;
    const member = await session.guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot) return;
    session.busy.add(userId);
    try {
        const stream = session.connection.receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 900 },
        });
        const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
        const chunks = [];
        stream.pipe(decoder);
        decoder.on('data', chunk => {
            if (chunks.reduce((n, b) => n + b.length, 0) < 48000 * 2 * 2 * 20) chunks.push(chunk);
        });
        await Promise.race([once(decoder, 'end'), once(decoder, 'error').then(([e]) => Promise.reject(e))]);
        const pcm = Buffer.concat(chunks);
        if (pcm.length < 48000 * 2 * 2 * 0.35) return;
        const transcript = await transcribe(pcm);
        if (transcript) await respondAndSpeak(guildId, transcript, member.displayName);
    } catch (error) {
        if (process.env.NODE_ENV !== 'production') console.error('[Dante voice]', error);
    } finally {
        session.busy.delete(userId);
    }
}

export async function startVoiceAssistant(guild, channel, botId) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY est absente.');
    stopVoiceAssistant(guild.id);
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
    });
    const player = createAudioPlayer();
    connection.subscribe(player);
    const session = { guild, connection, player, busy: new Set(), botId };
    sessions.set(guild.id, session);
    connection.receiver.speaking.on('start', userId => {
        void captureSpeaker(guild.id, userId);
    });
    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
        stopVoiceAssistant(guild.id);
        throw error;
    }
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
