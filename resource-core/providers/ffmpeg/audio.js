const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// 不通过 shell，不读取网络协议；单次探测/编码有时间及日志大小上限。
function run(executable, args) {
    const result = spawnSync(executable, args, { windowsHide: true, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    if (result.error) throw new Error('音频工具执行失败：' + result.error.message);
    if (result.status !== 0) throw new Error('音频解码或处理失败：' + (result.stderr || '').slice(-1600));
    return result;
}
const inputArgs = (input, resourceType) => ['-protocol_whitelist', 'file,pipe', '-f', resourceType, '-i', input];
const round = value => Math.round(value * 1000) / 1000;

function inspect(executable, input, resourceType) {
    const probe = JSON.parse(run(path.join(path.dirname(executable), 'ffprobe.exe'), ['-v', 'error', ...inputArgs(input, resourceType), '-show_streams', '-show_format', '-of', 'json']).stdout);
    const streams = probe.streams.filter(stream => stream.codec_type === 'audio');
    if (streams.length !== 1) throw new Error('只支持恰好一个音轨的音频文件');
    const stream = streams[0], durationSeconds = Number(stream.duration || probe.format.duration), sampleRate = Number(stream.sample_rate);
    if (![1, 2].includes(stream.channels) || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 14_400
        || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('首版支持单声道/双声道、8–192 kHz、最长 4 小时的音频');
    const supported = { wav: ['pcm_u8', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_f64le'], flac: ['flac'], mp3: ['mp3'], ogg: ['vorbis', 'opus'] };
    if (!supported[resourceType]?.includes(stream.codec_name)) throw new Error('音频编码与资源类型不匹配或暂不支持：' + stream.codec_name);
    const log = run(executable, ['-hide_banner', '-nostdin', '-nostats', '-v', 'info', '-xerror', '-err_detect', 'explode', ...inputArgs(input, resourceType),
        '-map', '0:a:0', '-af', 'ebur128=peak=sample+true:framelog=verbose', '-f', 'null', '-']).stderr;
    const summary = log.slice(log.lastIndexOf('Summary:'));
    const read = expression => {
        const match = summary.match(expression);
        if (!match) throw new Error('无法读取音频测量结果');
        const value = Number(match[1]);
        return Number.isFinite(value) ? value : null;
    };
    let integratedLufs = read(/\bI:\s+(-?inf|[-\d.]+) LUFS/);
    const truePeakDb = read(/True peak:\s+Peak:\s+(-?inf|[-\d.]+) dBFS/);
    const samplePeakDb = read(/Sample peak:\s+Peak:\s+(-?inf|[-\d.]+) dBFS/);
    const loudnessRangeLu = read(/\bLRA:\s+([-\d.]+) LU/);
    const warnings = [];
    if (samplePeakDb !== null && samplePeakDb >= -0.1) warnings.push('输入接近满刻度，可能已有削波；调整增益不能恢复已丢失的波形。');
    if (durationSeconds < 0.4 || integratedLufs === null || integratedLufs <= -69.9 || truePeakDb === null) {
        integratedLufs = null;
        warnings.push('音频过短、静音或低于响度门限，无法可靠计算整段响度；不会据此自动放大。');
    }
    return { durationSeconds: round(durationSeconds), sampleRate, channels: stream.channels, codec: stream.codec_name,
        bitsPerSample: Number(stream.bits_per_raw_sample || stream.bits_per_sample) || null,
        integratedLufs, truePeakDb, samplePeakDb, loudnessRangeLu, warnings };
}

function encoder(info, quality) {
    if (info.codec.startsWith('pcm_')) return ['-c:a', info.codec];
    if (info.codec === 'flac') return ['-c:a', 'flac', '-sample_fmt', info.bitsPerSample > 16 ? 's32' : 's16'];
    if (info.codec === 'mp3') return ['-c:a', 'libmp3lame', '-q:a', String(Math.max(0, 9 - quality))];
    if (info.codec === 'vorbis') return ['-c:a', 'libvorbis', '-q:a', String(quality)];
    return ['-c:a', 'libopus', '-b:a', '192k'];
}

function execute({ executable, input, output, operation, resourceType, parameters, providerOptions }) {
    const before = inspect(executable, input, resourceType);
    const audio = { before, warnings: [...before.warnings] };
    if (operation === 'audio-analyze') return { metadata: { audio } };
    const fail = message => { const error = new Error(message); error.metadata = { audio }; throw error; };
    if (before.truePeakDb === null || (operation === 'audio-normalize' && before.integratedLufs === null)) {
        audio.warnings.push('已保留原文件，不对无法可靠测量的音频进行归一化或静音增益处理。');
        return { skipped: true, metadata: { audio } };
    }
    const requestedGainDb = operation === 'audio-gain' ? parameters.gainDb : parameters.targetLufs - before.integratedLufs;
    audio.requestedGainDb = round(requestedGainDb);
    if (operation === 'audio-normalize') audio.targetLufs = parameters.targetLufs;
    audio.truePeakCeilingDb = parameters.truePeakDb;
    // ebur128 文本结果精度为 0.1 dB，额外保留 0.15 dB 测量余量。
    const ceiling = parameters.truePeakDb - 0.15;
    let gain = requestedGainDb;
    if (before.truePeakDb + gain > ceiling) {
        if (parameters.peakPolicy === 'reject') fail(`预计真峰值 ${round(before.truePeakDb + gain)} dBTP 超过安全上限 ${parameters.truePeakDb} dBTP，未处理；可改用限制整段增益。`);
        gain = ceiling - before.truePeakDb;
        audio.limited = true;
    }
    if (Math.abs(gain) < 0.000001) {
        audio.after = before; audio.appliedGainDb = 0;
        if (audio.targetLufs !== undefined) audio.targetReached = before.integratedLufs !== null && Math.abs(before.integratedLufs - audio.targetLufs) <= 0.3;
        if (audio.limited) audio.warnings.push('峰值空间不足，已限制整段增益为 0；未使用动态压缩。');
        audio.warnings.push('所需增益为 0，保留原始字节，未重新编码。');
        return { skipped: true, metadata: { audio } };
    }
    audio.warnings.push('输出重新编码并移除标签、封面等附加元数据；循环点等游戏标记需从原资源另行保留。');
    const lossy = ['mp3', 'vorbis', 'opus'].includes(before.codec);
    if (lossy) audio.warnings.push('有损音频重新编码会带来额外损失；建议从 WAV/FLAC 母版处理。');
    // 每次从原临时输入重做，不在前一轮有损输出上重复编码；不使用 loudnorm、限幅或压缩滤镜。
    for (let attempt = 0; attempt < 3; attempt++) {
        run(executable, ['-hide_banner', '-nostdin', '-nostats', '-v', 'error', '-xerror', '-err_detect', 'explode', '-y', ...inputArgs(input, resourceType),
            '-map', '0:a:0', '-map_metadata', '-1', '-vn', '-sn', '-dn', '-af', `volume=${gain.toFixed(6)}dB:precision=double`,
            ...encoder(before, providerOptions.lossyQuality), '-ar', String(before.sampleRate), '-ac', String(before.channels), '-f', resourceType, output]);
        const after = inspect(executable, output, resourceType);
        if (after.codec !== before.codec || after.channels !== before.channels || after.sampleRate !== before.sampleRate || Math.abs(after.durationSeconds - before.durationSeconds) > 0.15) fail('输出编码、声道、采样率或时长异常，未提交');
        if (after.truePeakDb !== null && after.truePeakDb > parameters.truePeakDb - 0.05) {
            if (parameters.peakPolicy === 'reject') fail(`编码后真峰值 ${after.truePeakDb} dBTP 超过安全上限，未提交`);
            gain -= after.truePeakDb - ceiling;
            audio.limited = true;
            continue;
        }
        audio.after = after;
        audio.warnings.push(...after.warnings.map(warning => '输出测量：' + warning));
        audio.appliedGainDb = round(gain);
        if (audio.limited) audio.warnings.push('为满足真峰值上限，已限制整段增益；未使用动态压缩，响度可能低于目标。');
        if (audio.targetLufs !== undefined) {
            audio.targetReached = after.integratedLufs !== null && Math.abs(after.integratedLufs - audio.targetLufs) <= 0.3;
            if (!audio.targetReached && !audio.limited) audio.warnings.push('输出响度与目标相差超过 0.3 LU，请结合试听确认。');
        }
        return { output, metadata: { audio } };
    }
    fs.unlinkSync(output);
    fail('三次固定增益调整后仍无法满足真峰值上限，已保留原文件');
}
module.exports = { run, inspect, execute };
