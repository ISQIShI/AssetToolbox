import { beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ServicePanel from '../src/components/ServicePanel.vue';
import { call } from '../src/core/api';
vi.mock('../src/core/api', () => ({ call: vi.fn() }));
let snapshot: any;
beforeEach(() => {
    snapshot = { configured: false, config: null, state: 'stopped', endpoints: null, owned: false, tokenFile: null };
    vi.resetAllMocks(); vi.mocked(call).mockImplementation(async (action, input: any) => {
        if (action === 'service-configure') snapshot = { ...snapshot, configured: true, config: input };
        if (action === 'service-start') snapshot = { ...snapshot, state: 'running', owned: true, endpoints: { apiUrl: 'http://127.0.0.1:1234/api/v8/', mcpUrl: null } };
        if (action === 'service-stop') snapshot = { ...snapshot, state: 'stopped' };
        return snapshot;
    });
});
async function fixture() {
    const wrapper = mount(ServicePanel);
    wrapper.element.open = true; await wrapper.trigger('toggle'); await flushPromises();
    const button = (text: string) => wrapper.findAll('button').find(item => item.text() === text)!;
    return { wrapper, button };
}
it('configures, starts, exports and stops through the five public actions; observing or unmounting never stops', async () => {
    const { wrapper, button } = await fixture();
    await wrapper.find('[aria-label="服务素材目录"]').setValue('D:\\Assets\nD:\\Audio');
    await wrapper.find('[aria-label="服务输出目录"]').setValue('D:\\Output');
    await button('保存服务配置').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('service-configure', expect.objectContaining({ policy: expect.objectContaining({ sourceRoots: ['D:\\Assets', 'D:\\Audio'], allowServiceManagement: false }) }));
    await button('启动服务').trigger('click'); await flushPromises();
    expect(wrapper.find('fieldset').attributes('disabled')).toBeDefined();
    await button('生成 stdio 配置').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('service-client-config', { transport: 'stdio' });
    await button('生成 HTTP 连接配置').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('service-client-config', { transport: 'http' });
    await button('安全停止服务').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('service-stop', {});
    vi.mocked(call).mockClear(); wrapper.unmount(); expect(call).not.toHaveBeenCalled();
});
it('shows startup failure without claiming the listener is running, and preserves edited configuration during refresh', async () => {
    const { wrapper, button } = await fixture();
    await wrapper.find('[aria-label="服务端口"]').setValue(1234);
    await button('保存服务配置').trigger('click'); await flushPromises();
    vi.mocked(call).mockImplementation(async action => { if (action === 'service-start') throw Error('DEPENDENCY_MISSING'); return snapshot; });
    await button('启动服务').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('DEPENDENCY_MISSING');
    expect(button('安全停止服务').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[aria-label="服务端口"]').element).toHaveProperty('value', '1234');
    await wrapper.find('[aria-label="服务端口"]').setValue(4321);
    await button('刷新服务状态').trigger('click'); await flushPromises();
    expect(wrapper.find('[aria-label="服务端口"]').element).toHaveProperty('value', '4321');
    wrapper.unmount();
});
