import { expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SelectBox from '../src/components/SelectBox.vue';

it('preserves the labelled button ID and resolves selected labels through nested menus', async () => {
    const wrapper = mount(SelectBox, { props: {
        id: 'resource-property', modelValue: 'width',
        options: [{ label: '图片', items: [{ label: '尺寸', items: [{ value: 'width', label: '宽度' }] }] }],
    } });
    const button = wrapper.get('button');
    expect(button.attributes('id')).toBe('resource-property');
    expect(button.attributes('aria-haspopup')).toBe('menu');
    expect(button.text()).toBe('宽度');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await wrapper.setProps({ disabled: true }); expect(button.attributes('disabled')).toBeDefined();
    wrapper.unmount();
});
