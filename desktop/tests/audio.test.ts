import { expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import AudioResults from '../src/components/AudioResults.vue';
import { config, definition } from './fixtures';
import { createStep, processingRequest } from '../src/core/model';
import { createWorkbench } from '../src/core/workbench';
import type { AudioResult, Definition } from '../src/core/types';
vi.mock('../src/core/api', () => ({ call: vi.fn(), chooseFolder: vi.fn(), openReport: vi.fn(), openProviderSource: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));
const catalog: Definition = structuredClone(definition);
catalog.operations.push(
    { id: 'audio-analyze', displayName: '音频分析', description: '', version: '1.0.0', accepts: ['image'], resultPolicy: 'observe', fields: [] },
    { id: 'audio-gain', displayName: '音频增益', description: '', version: '1.0.0', accepts: ['image'], resultPolicy: 'valid-output', preserveOriginal: true, fields: [] },
);
catalog.providers[0]!.supports.push(...['audio-analyze', 'audio-gain'].map(operation => ({ operation, resourceType: 'png' })));
catalog.providers[0]!.adapters.push(...['audio-analyze', 'audio-gain'].map(operation => ({ operation, version: '1.0.0', fields: [] })));

it('analysis-only requests need no destination and omit remembered output and backup paths', () => {
    const value = { ...config, saveMode: 'saveAs' as const, outputDir: '', pipeline: [createStep(catalog, 'png', 'audio-analyze')] };
    const request = processingRequest(value, 'process', catalog);
    expect(request.outputDir).toBeUndefined(); expect(request.backupDir).toBeUndefined();
    expect(processingRequest({ ...value, outputDir: 'D:\\old' }, 'preview', catalog).outputDir).toBeUndefined();
});

it('adding or selecting a protected audio operation defaults to save-as and blocks unbacked overwrite', () => {
    const bench = createWorkbench(); bench.boot.value = { config, definition: catalog, warnings: [] }; bench.config.value = structuredClone(config);
    bench.addStep('png', 'audio-gain'); expect(bench.config.value.saveMode).toBe('saveAs');
    bench.config.value.saveMode = 'overwrite';
    bench.updateStep(0, createStep(catalog, 'png', 'audio-gain')); expect(bench.config.value.saveMode).toBe('saveAs');
    expect(() => processingRequest({ ...bench.config.value!, saveMode: 'overwrite', backupEnabled: false }, 'process', catalog)).toThrow('必须启用备份');
    expect(processingRequest({ ...bench.config.value!, saveMode: 'overwrite', backupEnabled: true }, 'process', catalog).backupDir).toBe(config.backupDir);
});

it('renders unavailable measurements, actual gain, target failure and uncommitted results explicitly', () => {
    const row: AudioResult = { path: '音频/短音.wav', operation: 'audio-normalize', status: 'processed', fileStatus: 'failed', requestedGainDb: 20, appliedGainDb: 1,
        targetLufs: -18, targetReached: false, limited: true, message: '为满足真峰值上限，已限制整段增益；未使用动态压缩。',
        before: { durationSeconds: 0.1, sampleRate: 48000, channels: 2, codec: 'pcm_s16le', bitsPerSample: 16, integratedLufs: null, samplePeakDb: -3, truePeakDb: -2, loudnessRangeLu: 0, warnings: [] } };
    const wrapper = mount(AudioResults, { props: { results: [row], total: 101 } });
    expect(wrapper.text()).toContain('无法测量 / 不适用'); expect(wrapper.text()).not.toContain('null');
    expect(wrapper.text()).toContain('未提交'); expect(wrapper.text()).toContain('未达到'); expect(wrapper.text()).toContain('未使用动态压缩');
    expect(wrapper.text()).toContain('20.0 dB / 1.0 dB'); expect(wrapper.text()).toContain('仅显示前 1 项');
});
