import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import TasksView from '../src/views/TasksView.vue';
import { createWorkbench, workbenchKey } from '../src/core/workbench';
import { call, openFolder } from '../src/core/api';
import { task } from './fixtures';

vi.mock('../src/core/api', () => ({ call: vi.fn(), openFolder: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const music = { ...task, id: 'music-01', source: 'D:\\素材\\音乐' };
const sprites = { ...task, id: 'sprites-02', source: 'D:\\素材\\角色' };

function setup() {
    const bench = createWorkbench();
    bench.tasks.value = [music, sprites];
    return mount(TasksView, { global: { provide: { [workbenchKey as symbol]: bench } } });
}

it('搜索仅展示可见任务的详情，零匹配时移除操作，清除后恢复明确选中的任务', async () => {
    const wrapper = setup();
    const search = wrapper.get('[aria-label="搜索任务"]');
    await wrapper.findAll('.row')[1]!.trigger('click');
    expect(wrapper.get('.detail h2').text()).toBe('角色');
    await search.setValue('音乐');
    expect(wrapper.get('.row[aria-current="true"]').text()).toContain('音乐');
    expect(wrapper.get('.detail h2').text()).toBe('音乐');
    await wrapper.get('[aria-label="打开来源文件夹"]').trigger('click');
    expect(openFolder).toHaveBeenCalledWith(music.source);
    await search.setValue('没有这个编号');
    expect(wrapper.get('[aria-label="任务列表"]').text()).toContain('没有匹配的任务');
    expect(wrapper.find('.row').exists()).toBe(false);
    expect(wrapper.find('.detail article').exists()).toBe(false);
    expect(wrapper.findAll('.detail button')).toHaveLength(0);
    await search.setValue('');
    expect(wrapper.get('.row[aria-current="true"]').text()).toContain('角色');
    expect(wrapper.get('.detail h2').text()).toBe('角色');
    expect(call).not.toHaveBeenCalled();
    wrapper.unmount();
});

it.each([
    ['继续未完成', 'resume'], ['重试失败项', 'retry'], ['检查备份', 'restore-preview'],
])('按编号搜索后的“%s”只提交可见任务', async (label, mode) => {
    const wrapper = setup();
    await wrapper.findAll('.row')[1]!.trigger('click');
    await wrapper.get('[aria-label="搜索任务"]').setValue(music.id);
    vi.mocked(call)
        .mockResolvedValueOnce({ jobId: 'job-test' })
        .mockResolvedValueOnce({ done: true, phase: 'finished', processed: 1, total: 1 })
        .mockResolvedValueOnce({ items: [music, sprites], nextOffset: null });
    await wrapper.findAll('.detail button').find(button => button.text() === label)!.trigger('click');
    await flushPromises();
    expect(call).toHaveBeenCalledWith('submit', { request: { mode, taskId: music.id }, idempotencyKey: expect.any(String) });
    wrapper.unmount();
});
