const { createHash } = require('node:crypto');
const { loadPolicy, authorize } = require('./policy');
const contexts = new WeakSet();
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function create(policy, lifetime, settings) {
    if (!['connection', 'server'].includes(lifetime)) throw new Error('无效应用生命周期');
    const context = Object.freeze({
        policy: freeze(policy), lifetime, settings,
        scope: createHash('sha256').update(JSON.stringify(policy ? stable(policy) : { local: true })).digest('hex'),
        authorize(request) { if (policy) authorize(request, policy); },
    });
    contexts.add(context);
    return context;
}
// 仅由入口启动代码选择；请求 JSON 不能构造上下文或扩权。
const localContext = ({ settings = false } = {}) => create(null, 'connection', settings);
const policyContext = (filename, lifetime = 'connection') => create(loadPolicy(filename), lifetime, false);
function assertContext(context) { if (!contexts.has(context)) throw new Error('必须通过启动代码创建应用上下文'); return context; }
module.exports = { localContext, policyContext, assertContext };
