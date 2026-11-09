const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { byExtension, providers, operations, normalizePipeline } = require('./framework/registry');
const { relativeFile, safeSource, digest } = require('./tasks');
const { providerAvailability } = require('./framework/availability');

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
    const pipeline = normalizePipeline(options.pipeline);
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
            if (!byExtension.has(path.extname(filename).toLowerCase())) throw new Error('任务所需资源类型未加载：' + relative);
            return filename;
        });
        collected = { root: sourceRoot, files };
    } else collected = collectResources(sourceRoot, { exclude: excluded, shouldCancel: options.shouldCancel, onProgress: options.onProgress });
    return { ...collected, pipeline, outputRoot, backupRoot };
}

// 只读预检：不读取素材内容、不执行转换；允许提供方启动只读依赖检查进程。
function scanFolder(folder, options = {}) {
    const { root, files, pipeline, outputRoot, backupRoot, cancelled } = prepareFolder(folder, options);
    const result = { root, outputRoot, backupRoot, total: files.length, checked: 0, totalBytes: 0, enabledFiles: 0,
        conflicts: 0, issues: [], resources: [], cancelled: Boolean(cancelled) };
    const groups = new Map();
    const issue = message => { if (result.issues.length < 30) result.issues.push(message); };
    for (const [index, filename] of files.entries()) {
        if (result.cancelled || options.shouldCancel?.()) { result.cancelled = true; break; }
        const relative = path.relative(root, filename);
        options.onProgress?.({ phase: 'checking', total: files.length, processed: index, current: relative });
        const resourceDefinition = byExtension.get(path.extname(filename).toLowerCase());
        let group = groups.get(resourceDefinition.id);
        if (!group) {
            const steps = pipeline.filter(step => step.enabled && step.resourceType === resourceDefinition.id);
            const enabled = steps.length > 0;
            group = { id: resourceDefinition.id, name: resourceDefinition.displayName, enabled, count: 0, bytes: 0 };
            groups.set(resourceDefinition.id, group);
            for (const step of steps) {
                const provider = providers.get(step.provider);
                const availability = providerAvailability(provider);
                if (!availability.available) issue('缺少处理工具或依赖：' + provider.id + '：' + availability.reason);
            }
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
    result.resources = [...groups.values()];
    return result;
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
        throw new Error('原文件在处理期间发生变化，已取消替换');
    }
}

function replaceIfUnchanged(filename, original, processed, mode) {
    // 在原目录中生成替换文件，再重命名，避免写入中断留下半张文件。
    const replacement = path.join(path.dirname(filename), `.resource-process-${randomUUID()}.tmp`);
    let created = false;
    try {
        const descriptor = fs.openSync(replacement, 'wx', mode);
        created = true;
        try {
            fs.writeFileSync(descriptor, processed);
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

function processResource(filename, workDirectory, executables, pipeline) {
    const type = byExtension.get(path.extname(filename).toLowerCase());
    if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('文件已变为符号链接，已取消处理');
    const original = fs.readFileSync(filename), mode = fs.statSync(filename).mode;
    const steps = pipeline.filter(step => step.enabled && step.resourceType === type.id), stepResults = [];
    const unchanged = { original, output: original, mode, changed: false, stepResults };
    if (!steps.length) return { ...unchanged, reason: '该资源未配置启用的处理步骤' };
    const input = path.join(workDirectory, 'input', 'resource' + type.extensions[0]);
    const output = path.join(workDirectory, 'output' + type.extensions[0]);
    let current = original;
    try {
        if (!type.validate(current)) throw new Error('文件内容不是有效的 ' + type.displayName + ' 格式');
        for (const step of steps) {
            const provider = providers.get(step.provider), operation = operations.get(step.operation);
            fs.writeFileSync(input, current);
            if (fs.existsSync(output)) fs.unlinkSync(output);
            const result = provider.execute({ executable: executables.get(provider.id), input, output, workDirectory,
                parameters: step.parameters, providerOptions: step.providerOptions, resourceType: type.id });
            if (result?.then) throw new Error('execute 必须同步返回；异步库须通过工作进程适配');
            if (result?.skipped) { stepResults.push({ id: step.id, operation: step.operation, provider: step.provider, status: 'skipped', inputBytes: current.length, outputBytes: current.length }); continue; }
            if (typeof result?.output !== 'string' || !isWithin(workDirectory, path.resolve(result.output)) || !isWithin(workDirectory, fs.realpathSync(result.output)) || fs.lstatSync(result.output).isSymbolicLink() || !fs.statSync(result.output).isFile()) throw new Error('提供方输出必须是工作目录内的普通文件');
            const next = fs.readFileSync(result.output);
            if (!type.validate(next)) throw new Error('处理结果格式无效，保留原文件');
            const accepted = operation.resultPolicy === 'valid-output' || next.length < current.length;
            stepResults.push({ id: step.id, operation: step.operation, provider: step.provider, status: accepted ? 'processed' : 'skipped',
                inputBytes: current.length, outputBytes: accepted ? next.length : current.length, ...(result.metadata ? { metadata: result.metadata } : {}) });
            if (accepted) current = next;
        }
        return { original, output: current, mode, changed: !current.equals(original), stepResults };
    } catch (error) {
        const failed = steps[stepResults.length];
        if (failed) stepResults.push({ id: failed.id, operation: failed.operation, provider: failed.provider, status: 'failed', message: error.message.replaceAll(input, filename) });
        return { ...unchanged, error: new Error(error.message.replaceAll(input, filename)) };
    } finally {
        for (const temporary of [input, output]) if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

function processFolder(folder, options = {}) {
    const { log = console.log, onProgress = () => {}, onFile = () => {}, shouldCancel = () => false } = options;
    // 参数校验必须早于扫描和文件写入；界面/API/命令行使用相同规则。
    const started = Date.now();
    const { root, files, pipeline, outputRoot, backupRoot, cancelled } = prepareFolder(folder, options);
    const summary = { total: files.length, processed: 0, skipped: 0, failed: 0, savedBytes: 0, copied: 0, backedUp: 0, backupDirectory: null };
    if (cancelled || shouldCancel()) return { ...summary, cancelled: true };
    const backupSession = backupRoot && (options.backupSession || path.join(backupRoot, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`));
    if (backupSession && (path.dirname(backupSession) !== backupRoot || !path.basename(backupSession).startsWith('backup-'))) throw new Error('备份子目录无效');
    log(`目标文件夹：${root}`);
    log('处理步骤：' + pipeline.filter(step => step.enabled).map(step => step.resourceType + '/' + step.operation + '/' + step.provider).join(' → '));
    if (outputRoot) log(`另存为：${outputRoot}（原文件不变，已有同名输出不会被覆盖）`);
    else if (backupRoot) log(`覆盖模式，启用备份：${backupSession}`);
    else log('覆盖模式，未启用备份。');
    log(`递归扫描完成，共找到 ${files.length} 个支持的文件（${[...byExtension.keys()].join(' / ') || '未发现资源类型'}）。`);
    if (!files.length) return summary;

    const present = new Set(files.map(file => byExtension.get(path.extname(file).toLowerCase()).id));
    const requiredProviders = [...new Set(pipeline.filter(step => step.enabled && present.has(step.resourceType)).map(step => providers.get(step.provider)))];
    const executables = new Map();
    for (const resourceDefinition of requiredProviders) {
        const availability = providerAvailability(resourceDefinition);
        if (!availability.available) throw new Error('缺少处理工具或依赖：' + resourceDefinition.id + '：' + availability.reason + (resourceDefinition.acquisition ? '；获取：' + resourceDefinition.acquisition.url : ''));
        if (!resourceDefinition.executableName) continue;
        const executable = path.join(require('./framework/dependencies/runtime').runtimeDirectory(resourceDefinition), resourceDefinition.executableName);
        if (!fs.existsSync(executable)) throw new Error('缺少处理工具：' + executable);
        executables.set(resourceDefinition.id, executable);
    }

    const tempRoot = fs.realpathSync(os.tmpdir());
    const workDirectory = fs.mkdtempSync(path.join(tempRoot, 'asset-toolbox-process-'));
    try {
        fs.mkdirSync(path.join(workDirectory, 'input'));
        for (const resourceDefinition of requiredProviders) {
            if (resourceDefinition.prepare) executables.set(resourceDefinition.id, resourceDefinition.prepare({ executable: executables.get(resourceDefinition.id), workDirectory }));
        }
        for (const [index, filename] of files.entries()) {
            if (shouldCancel()) { summary.cancelled = true; break; }
            const relativePath = path.relative(root, filename);
            const record = { path: relativePath, resourceType: byExtension.get(path.extname(filename).toLowerCase()).id,
                status: 'failed', originalBytes: null, outputBytes: null, savedBytes: 0, copied: false, backedUp: false, message: '' };
            onProgress({ phase: 'processing', total: files.length, processed: index, current: relativePath, summary: { ...summary } });
            try {
                safeSource(root, filename);
                options.beforeFile?.(relativePath, filename);
                const result = processResource(filename, workDirectory, executables, pipeline);
                record.steps = result.stepResults;
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
                options.beforeCommit?.({ ...record, status: result.error ? 'failed' : result.changed ? 'processed' : 'skipped',
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
                    summary.processed++;
                    summary.savedBytes += result.original.length - result.output.length;
                    record.status = 'processed'; record.savedBytes = result.original.length - result.output.length;
                    log(`[${index + 1}/${files.length}] 已处理${outputRoot ? '并另存' : ''} ${relativePath} (${result.original.length} → ${result.output.length} 字节)`);
                } else {
                    summary.skipped++;
                    record.status = 'skipped'; record.message = result.reason || '无需处理或未满足质量要求';
                    log(`[${index + 1}/${files.length}] ${outputRoot ? '已复制原文件' : '保留原文件'} ${relativePath}（${result.reason || '无需处理或未满足质量要求'}）`);
                }
            } catch (error) {
                summary.failed++;
                record.message = error.message;
                log(`[${index + 1}/${files.length}] 失败 ${relativePath}：${error.message}`);
            }
            onFile(record);
            onProgress({ phase: 'processing', total: files.length, processed: index + 1, current: relativePath, summary: { ...summary } });
        }
    } finally {
        // 只删除本次创建、且已确认位于系统临时目录下的工作目录。
        const resolvedWorkDirectory = fs.realpathSync(workDirectory);
        if (path.dirname(resolvedWorkDirectory) !== tempRoot || !path.basename(resolvedWorkDirectory).startsWith('asset-toolbox-process-')) {
            throw new Error(`临时目录位置异常，已停止清理：${resolvedWorkDirectory}`);
        }
        fs.rmSync(resolvedWorkDirectory, { recursive: true, force: true });
    }

    log(`${summary.cancelled ? '已取消（保留已完成结果）' : '处理完成'}：处理 ${summary.processed}，保留 ${summary.skipped}，复制原文件 ${summary.copied}，备份 ${summary.backedUp}，失败 ${summary.failed}；节省 ${(summary.savedBytes / 1024).toFixed(2)} KB，耗时 ${((Date.now() - started) / 1000).toFixed(1)} 秒。`);
    if (summary.backupDirectory) log(`原文件备份位置：${summary.backupDirectory}`);
    return summary;
}

module.exports = { collectResources, scanFolder, processFolder, prepareFolder };
