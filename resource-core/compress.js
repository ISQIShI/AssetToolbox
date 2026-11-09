const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { FIELDS, optionFlag, normalizeOptions, parseOptionValue, optionsFromValues } = require('./framework/options');
const { byExtension } = require('./framework/registry');
const { relativeFile, safeSource, digest } = require('./tasks');

function isWithin(parent, child) {
    const relative = path.relative(parent, child);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// 目标可尚未创建；先解析现有父目录的真实路径，以识别目录联接和路径别名。
function resolveDirectory(directory) {
    if (typeof directory !== 'string' || !directory.trim()) throw new Error('文件夹路径不能为空');
    let current = path.resolve(directory);
    const suffix = [];
    while (true) {
        try {
            fs.lstatSync(current);
            const resolved = fs.realpathSync(current);
            if (!fs.statSync(resolved).isDirectory()) throw new Error(`目标不是文件夹：${current}`);
            return path.join(resolved, ...suffix);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            // 已存在但损坏的链接不能作为新目录使用。
            try {
                if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`目录链接无效：${current}`);
            } catch (linkError) {
                if (linkError.code !== 'ENOENT') throw linkError;
            }
            const parent = path.dirname(current);
            if (parent === current) throw error;
            suffix.unshift(path.basename(current));
            current = parent;
        }
    }
}

function validateDestination(sourceRoot, directory) {
    const destination = resolveDirectory(directory);
    if (isWithin(destination, sourceRoot)) {
        throw new Error('输出或备份目录不能与原文件目录相同，也不能是原文件目录的上级目录');
    }
    return destination;
}

function collectResources(folder, { exclude = [], extensions = byExtension, shouldCancel = () => false, onProgress = () => {} } = {}) {
    const root = fs.realpathSync(path.resolve(folder));
    if (!fs.statSync(root).isDirectory()) {
        throw new Error(`目标不是文件夹：${root}`);
    }
    const files = [];
    const pending = [root];
    while (pending.length) {
        if (shouldCancel()) return { root, files: files.sort(), cancelled: true };
        const directory = pending.pop();
        onProgress({ phase: 'scanning', found: files.length, current: path.relative(root, directory) });
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (shouldCancel()) return { root, files: files.sort(), cancelled: true };
            const filename = path.join(directory, entry.name);
            if (exclude.some(excluded => isWithin(excluded, filename))) continue;
            // 不跟随符号链接或目录联接，避免循环及修改选定目录之外的文件。
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) {
                pending.push(filename);
            } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
                files.push(filename);
            }
        }
    }
    return { root, files: files.sort() };
}

function prepareFolder(folder, options) {
    const settings = normalizeOptions(options);
    if (options.outputDir !== undefined && options.backupDir !== undefined) throw new Error('另存为与覆盖备份不能同时启用');
    const sourceRoot = fs.realpathSync(path.resolve(folder));
    if (!fs.statSync(sourceRoot).isDirectory()) throw new Error('目标不是文件夹：' + sourceRoot);
    const outputRoot = options.outputDir !== undefined ? validateDestination(sourceRoot, options.outputDir) : null;
    const backupRoot = options.backupDir !== undefined ? validateDestination(sourceRoot, options.backupDir) : null;
    const excluded = [outputRoot, backupRoot].filter(Boolean);
    let collected;
    if (options.fileList !== undefined) {
        if (!Array.isArray(options.fileList) || new Set(options.fileList).size !== options.fileList.length) throw new Error('待处理文件清单无效');
        const files = options.fileList.map(relative => {
            const filename = relativeFile(sourceRoot, relative);
            if (excluded.some(directory => isWithin(directory, filename))) throw new Error('任务文件位于输出或备份目录内');
            if (!byExtension.has(path.extname(filename).toLowerCase())) throw new Error('任务所需压缩器未加载：' + relative);
            return filename;
        });
        collected = { root: sourceRoot, files };
    } else collected = collectResources(sourceRoot, { exclude: excluded, shouldCancel: options.shouldCancel, onProgress: options.onProgress });
    return { ...collected, settings, outputRoot, backupRoot };
}

// 只读预检：不读取文件内容、不启动编码器、不创建输出或备份目录。
function scanFolder(folder, options = {}) {
    const { root, files, settings, outputRoot, backupRoot, cancelled } = prepareFolder(folder, options);
    const result = { root, outputRoot, backupRoot, total: files.length, checked: 0, totalBytes: 0, enabledFiles: 0,
        conflicts: 0, issues: [], modules: [], cancelled: Boolean(cancelled) };
    const groups = new Map();
    const issue = message => { if (result.issues.length < 30) result.issues.push(message); };
    for (const [index, filename] of files.entries()) {
        if (result.cancelled || options.shouldCancel?.()) { result.cancelled = true; break; }
        const relative = path.relative(root, filename);
        options.onProgress?.({ phase: 'checking', total: files.length, processed: index, current: relative });
        const processor = byExtension.get(path.extname(filename).toLowerCase());
        let group = groups.get(processor.id);
        if (!group) {
            const enabled = Boolean(processor.isEnabled(settings));
            group = { id: processor.id, name: processor.config.displayName, enabled, count: 0, bytes: 0 };
            groups.set(processor.id, group);
            if (enabled && processor.executableName && !fs.existsSync(path.join(processor.directory, processor.executableName))) issue('缺少压缩器：' + processor.id + '/' + processor.executableName);
        }
        const bytes = fs.statSync(filename).size;
        group.count++; group.bytes += bytes; result.totalBytes += bytes;
        if (group.enabled) result.enabledFiles++;
        if (outputRoot) {
            const target = path.join(outputRoot, relative);
            // 同名输出、父路径为文件或链接均会阻止安全写入。
            let candidate = target;
            while (true) {
                let info;
                try { info = fs.lstatSync(candidate); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
                if (info && (candidate === target || info.isSymbolicLink() || !info.isDirectory())) {
                    result.conflicts++; issue('输出冲突：' + relative); break;
                }
                const parent = path.dirname(candidate);
                if (parent === candidate) break;
                candidate = parent;
            }
        }
    }
    result.checked = [...groups.values()].reduce((count, group) => count + group.count, 0);
    result.modules = [...groups.values()];
    return result;
}

// 保留旧的文件扫描 API；通用流水线使用 collectResources。
function collectImages(folder, options = {}) {
    return collectResources(folder, { ...options, extensions: new Set(['.png', '.jpg', '.jpeg']) });
}

function ensureDirectory(directory) {
    const parent = path.dirname(directory);
    if (parent !== directory) ensureDirectory(parent);
    let info;
    try {
        info = fs.lstatSync(directory);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        fs.mkdirSync(directory);
        info = fs.lstatSync(directory);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error(`目标路径包含链接或非文件夹，已停止写入：${directory}`);
    }
}

function destinationFile(root, relativePath) {
    const filename = path.join(root, relativePath);
    if (!isWithin(root, filename) || filename === root) throw new Error('输出文件路径越界');
    ensureDirectory(path.dirname(filename));
    return filename;
}

// wx 保证已有输出或备份不会被覆盖；写入失败时移除本次未完成的文件。
function writeNewFile(filename, data, mode) {
    let descriptor;
    let created = false;
    try {
        descriptor = fs.openSync(filename, 'wx', mode);
        created = true;
        fs.writeFileSync(descriptor, data);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
    } catch (error) {
        if (descriptor !== undefined) fs.closeSync(descriptor);
        if (created) fs.unlinkSync(filename);
        if (error.code === 'EEXIST') throw new Error(`目标文件已存在，未覆盖：${filename}`);
        throw error;
    }
}

function assertUnchanged(filename, original) {
    if (fs.lstatSync(filename).isSymbolicLink() || !fs.readFileSync(filename).equals(original)) {
        throw new Error('原文件在压缩期间发生变化，已取消替换');
    }
}

function replaceIfUnchanged(filename, original, compressed, mode) {
    // 在原目录中生成替换文件，再重命名，避免写入中断留下半张文件。
    const replacement = path.join(path.dirname(filename), `.resource-compress-${randomUUID()}.tmp`);
    let created = false;
    try {
        const descriptor = fs.openSync(replacement, 'wx', mode);
        created = true;
        try {
            fs.writeFileSync(descriptor, compressed);
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        assertUnchanged(filename, original);
        fs.renameSync(replacement, filename);
    } finally {
        if (created && fs.existsSync(replacement)) fs.unlinkSync(replacement);
    }
}

function compressResource(filename, workDirectory, executables, settings) {
    const processor = byExtension.get(path.extname(filename).toLowerCase());
    if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('文件已变为符号链接，已取消处理');
    const original = fs.readFileSync(filename);
    const mode = fs.statSync(filename).mode;
    const unchanged = { original, output: original, mode, changed: false };
    // 禁用类型不调用工具、不要求对应 EXE；另存时原样复制。
    if (!processor.isEnabled(settings)) return { ...unchanged, reason: '该格式未启用压缩' };
    const input = path.join(workDirectory, 'input', 'resource' + processor.extensions[0]);
    const output = path.join(workDirectory, 'output' + processor.extensions[0]);
    try {
        if (!processor.validate(original)) throw new Error('文件内容不是有效的 ' + processor.id.toUpperCase() + ' 格式');
        fs.writeFileSync(input, original);
        const result = processor.compress({ executable: executables.get(processor.id), input, output, workDirectory, settings });
        if (result.skipped) return unchanged;
        const compressed = fs.readFileSync(result.output);
        if (!processor.validate(compressed)) throw new Error('压缩结果无效，保留原文件');
        if (compressed.length >= original.length) return unchanged;
        return { original, output: compressed, mode, changed: true };
    } catch (error) {
        return { ...unchanged, error: new Error(error.message.replaceAll(input, filename)) };
    } finally {
        for (const temporary of [input, output]) if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

function compressFolder(folder, options = {}) {
    const { log = console.log, onProgress = () => {}, onFile = () => {}, shouldCancel = () => false } = options;
    // 参数校验必须早于扫描和文件写入；界面/API/命令行使用相同规则。
    const started = Date.now();
    const { root, files, settings, outputRoot, backupRoot, cancelled } = prepareFolder(folder, options);
    const summary = { total: files.length, compressed: 0, skipped: 0, failed: 0, savedBytes: 0, copied: 0, backedUp: 0, backupDirectory: null };
    if (cancelled || shouldCancel()) return { ...summary, cancelled: true };
    const backupSession = backupRoot && (options.backupSession || path.join(backupRoot, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`));
    if (backupSession && (path.dirname(backupSession) !== backupRoot || !path.basename(backupSession).startsWith('backup-'))) throw new Error('备份子目录无效');
    log(`目标文件夹：${root}`);
    log('压缩参数：' + FIELDS.map(field => `${field.label}=${settings[field.key]}`).join('，'));
    if (outputRoot) log(`另存为：${outputRoot}（原文件不变，已有同名输出不会被覆盖）`);
    else if (backupRoot) log(`覆盖模式，启用备份：${backupSession}`);
    else log('覆盖模式，未启用备份。');
    log(`递归扫描完成，共找到 ${files.length} 个支持的文件（${[...byExtension.keys()].join(' / ') || '未发现模块'}）。`);
    if (!files.length) return summary;

    const requiredProcessors = [...new Set(files.map(file => byExtension.get(path.extname(file).toLowerCase())))].filter(processor => processor.isEnabled(settings));
    const executables = new Map();
    for (const processor of requiredProcessors) {
        if (!processor.executableName) continue;
        const executable = path.join(processor.directory, processor.executableName);
        if (!fs.existsSync(executable)) throw new Error('缺少压缩器：' + executable);
        executables.set(processor.id, executable);
    }

    const tempRoot = fs.realpathSync(os.tmpdir());
    const workDirectory = fs.mkdtempSync(path.join(tempRoot, 'asset-toolbox-compress-'));
    try {
        fs.mkdirSync(path.join(workDirectory, 'input'));
        for (const processor of requiredProcessors) {
            if (processor.prepare) executables.set(processor.id, processor.prepare({ executable: executables.get(processor.id), workDirectory }));
        }
        for (const [index, filename] of files.entries()) {
            if (shouldCancel()) { summary.cancelled = true; break; }
            const relativePath = path.relative(root, filename);
            const record = { path: relativePath, module: byExtension.get(path.extname(filename).toLowerCase()).id,
                status: 'failed', originalBytes: null, outputBytes: null, savedBytes: 0, copied: false, backedUp: false, message: '' };
            onProgress({ phase: 'compressing', total: files.length, processed: index, current: relativePath, summary: { ...summary } });
            try {
                safeSource(root, filename);
                options.beforeFile?.(relativePath, filename);
                const result = compressResource(filename, workDirectory, executables, settings);
                record.originalBytes = result.original.length;
                record.sourceHash = digest(result.original);
                const expectedHash = digest(result.output);
                assertUnchanged(filename, result.original);
                let previousOutput, outputTarget;
                if (outputRoot) {
                    outputTarget = destinationFile(outputRoot, relativePath);
                    let existing;
                    try { existing = fs.lstatSync(outputTarget); } catch (error) { if (error.code !== 'ENOENT') throw error; }
                    if (existing) {
                        const ownedHash = options.replaceOutputs?.get(relativePath);
                        if (!ownedHash) throw new Error('目标文件已存在，未覆盖：' + outputTarget);
                        if (existing.isSymbolicLink() || !existing.isFile()) throw new Error('之前的输出已变为链接或非文件，未覆盖');
                        previousOutput = fs.readFileSync(outputTarget);
                        if (digest(previousOutput) !== ownedHash) throw new Error('之前的失败副本已被修改，未覆盖');
                    }
                }
                options.beforeCommit?.({ ...record, status: result.error ? 'failed' : result.changed ? 'compressed' : 'skipped',
                    expectedHash, outputHash: outputRoot ? expectedHash : null, outputBytes: result.output.length,
                    savedBytes: result.changed ? result.original.length - result.output.length : 0,
                    copied: Boolean(outputRoot && !result.changed), backedUp: Boolean(backupSession && result.changed && !outputRoot),
                    message: result.error?.message || result.reason || '',
                });
                if (outputRoot) {
                    if (previousOutput !== undefined) replaceIfUnchanged(outputTarget, previousOutput, result.output, result.mode);
                    else writeNewFile(outputTarget, result.output, result.mode);
                    record.outputHash = expectedHash;
                    if (!result.changed) { summary.copied++; record.copied = true; }
                } else if (result.changed) {
                    let backupFile;
                    try {
                        assertUnchanged(filename, result.original);
                        if (backupSession) {
                            const candidate = destinationFile(backupSession, relativePath);
                            if (options.reuseBackup && fs.existsSync(candidate)) assertUnchanged(candidate, result.original);
                            else {
                                writeNewFile(candidate, result.original, result.mode);
                                record.newBackup = true;
                            }
                            backupFile = candidate;
                        }
                        replaceIfUnchanged(filename, result.original, result.output, result.mode);
                    } catch (error) {
                        // 替换未完成时撤销本张备份，只留下真正被替换的原文件。
                        if (backupFile && record.newBackup) fs.unlinkSync(backupFile);
                        throw error;
                    }
                    if (backupFile) {
                        summary.backedUp++;
                        record.backedUp = true;
                        summary.backupDirectory = backupSession;
                    }
                }
                record.outputBytes = result.output.length;
                if (result.error) {
                    throw new Error(`${result.error.message}${outputRoot ? '；已将原文件复制到输出目录' : ''}`);
                }
                if (result.changed) {
                    summary.compressed++;
                    summary.savedBytes += result.original.length - result.output.length;
                    record.status = 'compressed'; record.savedBytes = result.original.length - result.output.length;
                    log(`[${index + 1}/${files.length}] 已压缩${outputRoot ? '并另存' : ''} ${relativePath} (${result.original.length} → ${result.output.length} 字节)`);
                } else {
                    summary.skipped++;
                    record.status = 'skipped'; record.message = result.reason || '无需压缩或未满足质量要求';
                    log(`[${index + 1}/${files.length}] ${outputRoot ? '已复制原文件' : '保留原文件'} ${relativePath}（${result.reason || '无需压缩或未满足质量要求'}）`);
                }
            } catch (error) {
                summary.failed++;
                record.message = error.message;
                log(`[${index + 1}/${files.length}] 失败 ${relativePath}：${error.message}`);
            }
            onFile(record);
            onProgress({ phase: 'compressing', total: files.length, processed: index + 1, current: relativePath, summary: { ...summary } });
        }
    } finally {
        // 只删除本次创建、且已确认位于系统临时目录下的工作目录。
        const resolvedWorkDirectory = fs.realpathSync(workDirectory);
        if (path.dirname(resolvedWorkDirectory) !== tempRoot || !path.basename(resolvedWorkDirectory).startsWith('asset-toolbox-compress-')) {
            throw new Error(`临时目录位置异常，已停止清理：${resolvedWorkDirectory}`);
        }
        fs.rmSync(resolvedWorkDirectory, { recursive: true, force: true });
    }

    log(`${summary.cancelled ? '已取消（保留已完成结果）' : '处理完成'}：压缩 ${summary.compressed}，保留 ${summary.skipped}，复制原文件 ${summary.copied}，备份 ${summary.backedUp}，失败 ${summary.failed}；节省 ${(summary.savedBytes / 1024).toFixed(2)} KB，耗时 ${((Date.now() - started) / 1000).toFixed(1)} 秒。`);
    if (summary.backupDirectory) log(`原文件备份位置：${summary.backupDirectory}`);
    return summary;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (!args.length || args[0] === '--help' || args[0] === '-h') {
        console.log('用法：node compress.js "源文件夹" [--output "另存目录" | --backup "备份目录"]');
        console.log('添加 --preview 可只读扫描并输出 JSON 预检结果，不压缩、不保存配置。');
        console.log('模块参数（自动发现）：');
        for (const field of FIELDS) {
            const range = field.type === 'boolean' ? 'true|false' : field.type === 'enum' ? field.choices.map(choice => choice.value).join('|') :
                field.type === 'text' ? '文本' : field.min + '–' + field.max;
            console.log('  ' + optionFlag(field.key) + ' ' + range + '（' + field.label + '，默认 ' + field.default + '）' + (field.hint || ''));
        }
        process.exitCode = args.length === 1 && ['--help', '-h'].includes(args[0]) ? 0 : 1;
    } else {
        try {
            const options = {};
            const fieldsByFlag = new Map(FIELDS.map(field => [optionFlag(field.key), field]));
            const seen = new Set();
            let hasPayload = false;
            for (let index = 1; index < args.length;) {
                const option = args[index++];
                if (seen.has(option)) throw new Error('重复参数：' + option);
                seen.add(option);
                if (option === '--preview') { options.preview = true; continue; }
                const value = args[index++];
                const field = fieldsByFlag.get(option);
                if ((!field && !['--output', '--backup', '--options-base64', '--options-file'].includes(option)) || value === undefined || value.startsWith('--')) {
                    throw new Error('无效或缺少值的参数：' + option);
                }
                if (option === '--options-base64' || option === '--options-file') {
                    if (hasPayload || [...seen].some(flag => fieldsByFlag.has(flag))) throw new Error('参数载荷不能重复或与单独的模块选项同时使用');
                    const payload = option === '--options-file' ? fs.readFileSync(value, 'utf8').replace(/^\uFEFF/, '') : Buffer.from(value, 'base64').toString('utf8');
                    Object.assign(options, optionsFromValues(JSON.parse(payload)));
                    hasPayload = true;
                } else if (field) {
                    if (hasPayload) throw new Error('参数载荷不能与单独的模块选项同时使用');
                    options[field.key] = parseOptionValue(field, value);
                } else options[option === '--output' ? 'outputDir' : 'backupDir'] = value;
            }
            if (options.preview) {
                const preview = scanFolder(args[0], options);
                console.log(JSON.stringify(preview, null, 2));
                process.exitCode = preview.issues.length ? 1 : 0;
            } else {
                const summary = compressFolder(args[0], options);
                process.exitCode = summary.failed ? 1 : 0;
            }
        } catch (error) {
            console.error('压缩失败：' + error.message);
            process.exitCode = 1;
        }
    }
}

module.exports = { collectImages, collectResources, scanFolder, compressFolder, prepareFolder };
