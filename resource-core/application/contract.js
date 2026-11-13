const API = 'asset-toolbox.application/7';
const RESPONSE = 'asset-toolbox.response/7';
const JOB = 'asset-toolbox.job/5';
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' };
const parameters = { type: 'object', additionalProperties: { anyOf: [string, { type: 'number' }, { type: 'boolean' }] } };
const step = object({ id: string, resourceType: string, operation: string, provider: string, enabled: { type: 'boolean' }, parameters, providerOptions: parameters,
    versions: object(Object.fromEntries(['resourceType', 'operation', 'provider', 'adapter'].map(key => [key, string]))) }, ['id', 'resourceType', 'operation', 'provider', 'enabled']);
const selection = { type: 'array', minItems: 1, items: object({ path: string, backupHash: string, targetHash: { anyOf: [string, { type: 'null' }] } }) };
const request = { oneOf: [
    ...['preview', 'process'].map(mode => object({ mode: { const: mode }, folder: string, outputDir: string, backupDir: string, pipeline: { type: 'array', maxItems: 64, items: step } }, ['mode', 'folder', 'pipeline'])),
    ...['resume', 'retry', 'restore-preview'].map(mode => object({ mode: { const: mode }, taskId: string })),
    ...['restore', 'restore-retry'].map(mode => object({ mode: { const: mode }, taskId: string, selection })),
    object({ mode: { const: 'restore-export-preview' }, backupDir: string, outputDir: string }),
    object({ mode: { const: 'restore-export' }, backupDir: string, outputDir: string, selection }),
    object({ mode: { const: 'dependency-install' }, providerId: string }),
] };
const jobId = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const pagination = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } };
const retentionDays = { type: 'integer', minimum: 1, maximum: 3650, default: 30 };
const roots = { type: 'array', maxItems: 32, items: string };
const policy = object({ schema: { const: 'asset-toolbox.automation-policy/2' }, sourceRoots: roots, outputRoots: roots, backupRoots: roots,
    allowOverwrite: { type: 'boolean' }, allowRestore: { type: 'boolean' }, allowDependencyInstall: { type: 'boolean' }, allowServiceManagement: { type: 'boolean' } }, ['schema', 'sourceRoots', 'outputRoots', 'backupRoots']);
const inputSchemas = {
    'service-status': object({}),
    'service-configure': object({ port: { type: 'integer', minimum: 0, maximum: 65535 }, mcp: { type: 'boolean' }, policy }),
    'service-start': object({}), 'service-stop': object({}),
    'service-client-config': object({ transport: { enum: ['stdio', 'http'] } }),
    queue: object({}),
    'scheduling-set': object({ maxConcurrent: { type: 'integer', minimum: 1, maximum: 8 } }),
    capabilities: object({}), validate: object({ request }),
    submit: object({ request, idempotencyKey: { type: 'string', pattern: '^[a-zA-Z0-9._:-]{1,128}$' } }),
    status: object({ jobId }), cancel: object({ jobId }),
    results: object({ jobId, kind: { enum: ['files', 'audio', 'restore'] }, ...pagination }, ['jobId']),
    jobs: object(pagination, []), tasks: object(pagination, []),
    'storage-preview': object({ retentionDays, ...pagination }, []),
    'storage-clean': object({ retentionDays, selection: { type: 'array', minItems: 1, maxItems: 100, items: object({ jobId, fingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' } }) } }, ['retentionDays', 'selection']),
};
const ACTION_FIELDS = Object.freeze(Object.fromEntries(Object.entries(inputSchemas).map(([action, schema]) => [action, Object.keys(schema.properties)])));
module.exports = { API, RESPONSE, JOB, ACTION_FIELDS, inputSchemas };
