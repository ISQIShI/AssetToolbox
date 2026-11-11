import { beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createWorkbench, workbenchKey } from '../src/core/workbench';
import StorageMaintenance from '../src/components/StorageMaintenance.vue';
import { call } from '../src/core/api';
import type { StoragePreview } from '../src/core/types';
const native = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock('../src/core/api', () => ({ call: vi.fn(), chooseFolder: vi.fn(), openReport: vi.fn(), openProviderSource: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => native }));
const snapshot: StoragePreview = {
    items: [
        { jobId: 'a'.repeat(64), fingerprint: 'b'.repeat(64), mode: 'process', createdAt: '2026-01-01T00:00:00Z', bytes: 5000, eligible: true, reason: '可清理' },
        { jobId: 'c'.repeat(64), mode: 'process', createdAt: '2026-01-01T00:00:00Z', bytes: 0, eligible: false, reason: '任务尚未完成' },
    ], total: 2, nextOffset: null, retentionDays: 30, scannedAt: '', eligibleCount: 1, eligibleBytes: 5000, protectedCount: 1,
};
beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(call).mockImplementation(async action => action === 'storage-preview' ? structuredClone(snapshot) as any : { items: [], cleaned: 1, failed: 0, freedBytes: 4000 } as any);
});
function fixture() {
    const bench = createWorkbench();
    const wrapper = mount(StorageMaintenance, { global: { provide: { [workbenchKey as symbol]: bench } } });
    const button = (name: string) => wrapper.findAll('button').find(item => item.text() === name)!;
    return { bench, wrapper, button };
}
it('requires preview and explicit selection, excludes protected items and forwards only IDs and fingerprints', async () => {
    const { wrapper, button } = fixture();
    expect(call).not.toHaveBeenCalled(); expect(wrapper.find('input[type="number"]').element).toHaveProperty('value', '30');
    await button('预览清理范围').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('storage-preview', { retentionDays: 30, offset: 0, limit: 100 });
    expect(button('清理所选 0 项').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('input[type="checkbox"]')[1]!.attributes('disabled')).toBeDefined();
    await button('选择本页可清理项').trigger('click');
    await button('清理所选 1 项').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('storage-clean', { retentionDays: 30, selection: [{ jobId: 'a'.repeat(64), fingerprint: 'b'.repeat(64) }] });
    expect(button('清理所选 0 项').attributes('disabled')).toBeDefined();
    wrapper.unmount();
});
it('changing retention invalidates old selections and disallows invalid days', async () => {
    const { wrapper, button, bench } = fixture();
    await button('预览清理范围').trigger('click'); await flushPromises(); await button('选择本页可清理项').trigger('click');
    await wrapper.find('input[type="number"]').setValue('0');
    expect(bench.storagePreview.value).toBeUndefined(); expect(button('预览清理范围').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('1–3650');
    await wrapper.find('input[type="number"]').setValue('90');
    await button('预览清理范围').trigger('click'); await flushPromises();
    expect(call).toHaveBeenLastCalledWith('storage-preview', { retentionDays: 90, offset: 0, limit: 100 });
    wrapper.unmount();
});
it('a stale preview error clears the selection instead of retrying deletion automatically', async () => {
    const { wrapper, button, bench } = fixture();
    await button('预览清理范围').trigger('click'); await flushPromises(); await button('选择本页可清理项').trigger('click');
    vi.mocked(call).mockRejectedValueOnce(new Error('预览已过期，请重新预览'));
    await button('清理所选 1 项').trigger('click'); await flushPromises();
    expect(bench.error.value).toContain('预览已过期'); expect(bench.storagePreview.value).toBeUndefined();
    expect(vi.mocked(call).mock.calls.filter(([action]) => action === 'storage-clean')).toHaveLength(1);
    wrapper.unmount();
});
it('pagination clears hidden selections and job activity disables maintenance', async () => {
    const { wrapper, button, bench } = fixture();
    vi.mocked(call).mockResolvedValue({ ...snapshot, total: 101, nextOffset: 100 });
    await button('预览清理范围').trigger('click'); await flushPromises(); await button('选择本页可清理项').trigger('click');
    await button('下一页').trigger('click'); await flushPromises();
    expect(call).toHaveBeenLastCalledWith('storage-preview', { retentionDays: 30, offset: 100, limit: 100 });
    expect(button('清理所选 0 项').attributes('disabled')).toBeDefined();
    bench.submitting.value = true; await flushPromises();
    expect(button('预览清理范围').attributes('disabled')).toBeDefined();
    wrapper.unmount();
});
it('window close waits for maintenance to finish without cancelling an unrelated completed job', async () => {
    const { bench, wrapper } = fixture();
    let finish!: (value: StoragePreview) => void;
    vi.mocked(call).mockReturnValue(new Promise(resolve => { finish = resolve as typeof finish; }));
    const pending = bench.previewStorage(30);
    expect(await bench.requestClose()).toBe(false); expect(native.close).not.toHaveBeenCalled();
    finish(snapshot); await pending;
    expect(native.close).toHaveBeenCalledOnce(); expect(call).not.toHaveBeenCalledWith('cancel', expect.anything());
    wrapper.unmount();
});
