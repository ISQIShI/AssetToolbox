import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkVersions, compareVersions, parseVersion, root } from './version.mjs';

const git = (directory, args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export function releasePlan(tag, directory = root) {
    const version = checkVersions(directory);
    if (tag !== `v${version}`) throw new Error('标签必须精确等于 v + VERSION');
    const sha = git(directory, ['rev-parse', 'HEAD']);
    if (git(directory, ['rev-parse', `refs/tags/${tag}^{commit}`]) !== sha) throw new Error('标签与当前提交不一致');
    // 发布只接受已经进入 main 的提交；没有 origin/main 时明确失败。
    git(directory, ['merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main']);
    for (const previous of git(directory, ['tag', '--list', 'v*']).split(/\r?\n/).filter(Boolean)) {
        if (previous !== tag && compareVersions(version, previous.slice(1)) <= 0) throw new Error(`版本必须高于已有标签 ${previous}`);
    }
    const notePath = path.join(directory, 'docs/releases', version + '.md');
    const notes = fs.readFileSync(notePath, 'utf8').replace(/\r\n/g, '\n').trim();
    for (const heading of [`# ${tag}`, '## 变更', '## 兼容性', '## 验证', '## 获取与限制']) {
        if (!notes.split(/\r?\n/).includes(heading)) throw new Error(`版本说明缺少标题：${heading}`);
    }
    if (!notes.startsWith(`# ${tag}\n`)) throw new Error('版本说明首行必须为当前标签');
    for (const section of notes.split(/^## /m).slice(1)) {
        if (!section.slice(section.indexOf('\n') + 1).trim()) throw new Error('版本说明包含空章节');
    }
    if (/TODO|TBD|待填写|待补充/.test(notes)) throw new Error('版本说明仍含占位内容');
    return { tag, version, sha, notes, prerelease: Boolean(parseVersion(version).stage) };
}

export async function publishRelease(plan, { repository, token, runId, request = fetch }) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !token || !/^\d+$/.test(runId || '')) throw new Error('缺少有效的 GitHub 发布上下文');
    const base = `https://api.github.com/repos/${repository}`;
    async function api(route, method = 'GET', data, allowMissing = false) {
        const response = await request(base + route, {
            method, redirect: 'error', signal: AbortSignal.timeout(30000),
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json' },
            ...(data ? { body: JSON.stringify(data) } : {}),
        });
        if (allowMissing && response.status === 404) return null;
        if (!response.ok) throw new Error(`GitHub ${method} ${route} 失败：HTTP ${response.status}（令牌与响应正文不写日志）`);
        return response.json();
    }
    if ((await api('')).private !== false) throw new Error('当前分发策略要求公开源码仓库');
    if ((await api(`/commits/${encodeURIComponent(plan.tag)}`)).sha !== plan.sha) throw new Error('远端标签已变化，拒绝发布');
    const marker = `<!-- asset-toolbox-release:${plan.sha} -->`;
    const existing = await api(`/releases/tags/${encodeURIComponent(plan.tag)}`, 'GET', undefined, true);
    if (existing) {
        if (existing.draft || existing.prerelease !== plan.prerelease || !existing.body?.endsWith(marker) || !existing.body.startsWith(plan.notes + '\n\n')) {
            throw new Error('同名 Release 已存在但不匹配；禁止覆盖或自动删除');
        }
        return { status: 'already-published', url: existing.html_url };
    }
    const body = `${plan.notes}\n\n提交：\`${plan.sha}\`\n\n[发布验证](https://github.com/${repository}/actions/runs/${runId})\n\n仅提供 GitHub 自动生成的源码归档；不含可运行便携包、第三方工具或用户数据。\n\n${marker}`;
    const release = await api('/releases', 'POST', {
        tag_name: plan.tag, target_commitish: plan.sha, name: `AssetToolbox ${plan.tag}`, body,
        draft: false, prerelease: plan.prerelease, make_latest: plan.prerelease ? 'false' : 'legacy',
    });
    return { status: 'published', url: release.html_url };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [command, tag, ...extra] = process.argv.slice(2);
    if (!['--check', '--publish'].includes(command) || !tag || extra.length) throw new Error('用法：node scripts/release.mjs --check|--publish v1.2.3');
    const plan = releasePlan(tag);
    if (command === '--publish') {
        if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== `refs/tags/${tag}` || process.env.GITHUB_SHA !== plan.sha) throw new Error('只允许 CI 中匹配当前提交的标签 push 发布');
        console.log(await publishRelease(plan, { repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN, runId: process.env.GITHUB_RUN_ID }));
    } else console.log(JSON.stringify({ ...plan, notes: '(已核验版本说明)' }, null, 2));
}
