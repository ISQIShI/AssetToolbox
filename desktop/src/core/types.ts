// 与 resource-core 桌面桥接协议一一对应的类型；字段含义见 docs/architecture/protocol.md。
export type Value = string | number | boolean;
export interface StorageItem { jobId: string; mode: string; createdAt: string; finishedBefore?: string; bytes: number; eligible: boolean; reason: string; fingerprint?: string }
export interface StoragePreview { items: StorageItem[]; total: number; nextOffset: number | null; retentionDays: number; scannedAt: string; eligibleCount: number; eligibleBytes: number; protectedCount: number }
export interface StorageSelection { jobId: string; fingerprint: string }
export interface StorageResult { items: { jobId: string; freedBytes: number; cleaned: boolean; error?: string }[]; cleaned: number; failed: number; freedBytes: number }
export interface Field { key: string; type: 'integer' | 'number' | 'boolean' | 'enum' | 'text'; default: Value; label: string; hint?: string; min?: number; max?: number; decimalPlaces?: number; step?: number; maxLength?: number; choices?: { label: string; value: Value }[] }
export interface ResourceType { id: string; displayName: string; description?: string; kind: string; extensions: string[]; version: string }
export interface Operation { id: string; displayName: string; description: string; accepts: string[]; resultPolicy: 'smaller-only' | 'valid-output' | 'observe'; preserveOriginal?: boolean; fields: Field[]; version: string }
export interface Acquisition { name: string; version: string; license: string; url: string; source: string; instructions: string; redistribution: string; checkedAt: string }
export interface Support { resourceType: string; operation: string }
export interface Dependency { automatic: boolean; reason: string; targetVersion?: string; installedVersion?: string; checkedAt?: string; sources?: string[]; state?: 'missing' | 'unmanaged' | 'current' | 'update' | 'damaged'; action?: 'install' | 'update' | 'repair' | 'reinstall' }
export interface Adapter { operation: string; version: string; fields: Field[] }
export interface Provider { id: string; displayName: string; description: string; supports: Support[]; adapters: Adapter[]; version: string; availability?: { available: boolean; reason: string }; acquisition?: Acquisition | null; dependency?: Dependency }
export interface Definition { apiVersion: 3; resourceTypes: ResourceType[]; operations: Operation[]; providers: Provider[] }
export interface Step { id: string; resourceType: string; operation: string; provider: string; enabled: boolean; parameters: Record<string, Value>; providerOptions: Record<string, Value>; versions?: { resourceType: string; operation: string; provider: string; adapter: string } }
export interface Configuration { schema: 'asset-toolbox.settings/2'; sourceDir: string; outputDir: string; backupDir: string; saveMode: 'overwrite' | 'saveAs'; backupEnabled: boolean; pipeline: Step[] }
export interface Bootstrap { config: Configuration | null; definition: Definition | null; warnings: string[]; configError?: string; root?: string; nodeVersion?: string }
export interface Task { id: string; createdAt?: string; source?: string; outputDir?: string; backupSession?: string; total: number; completed: number; failed: number; pending: number; backupCount: number; restored: number; restoreFailed: number; restoreStarted: boolean; canResume: boolean; canRetry: boolean; canRestore: boolean; canContinueRestore: boolean; canRetryRestore: boolean; error?: string }
export type RestoreScope = 'all' | 'continue' | 'retry';
export interface RestoreFile { path: string; resourceType?: string; state: 'recoverable' | 'restored' | 'conflict'; selectable: boolean; queue: 'pending' | 'failed' | 'completed'; inLastSelection: boolean; backupBytes: number | null; currentBytes?: number | null; backupHash: string; targetHash: string | null; reason: string }
export interface RestorePreview { source: string; destination: string; total: number; checked: number; recoverable: number; restored: number; conflict: number; cancelled: boolean; files: RestoreFile[] }
export interface ScanPreview { total: number; checked: number; totalBytes: number; enabledFiles: number; conflicts: number; issues: string[]; resources: { id: string; name: string; enabled: boolean; count: number; bytes: number }[]; cancelled: boolean }
export interface Selection { path: string; backupHash: string; targetHash: string | null }
export type JobMode = 'preview' | 'process' | 'resume' | 'retry' | 'restore' | 'restore-retry' | 'restore-export' | 'restore-preview' | 'restore-export-preview' | 'dependency-install';
export interface JobRequest { mode: JobMode; folder?: string; pipeline?: Step[]; outputDir?: string; backupDir?: string; taskId?: string; selection?: Selection[]; providerId?: string }
export interface JobSummary { total: number; processed?: number; skipped: number; failed: number; savedBytes?: number; restored?: number; restoredBytes?: number; copied?: number; backedUp?: number; backupDirectory?: string }
export interface AudioMeasurement { durationSeconds: number; sampleRate: number; channels: number; codec: string; bitsPerSample: number | null; integratedLufs: number | null; samplePeakDb: number | null; truePeakDb: number | null; loudnessRangeLu: number | null; warnings: string[] }
export interface AudioResult { path: string; operation: string; status: string; fileStatus: string; before: AudioMeasurement; after?: AudioMeasurement; requestedGainDb?: number; appliedGainDb?: number; targetLufs?: number; targetReached?: boolean; limited?: boolean; message: string }
export interface JobState { queuePosition?: number; sequence?: number; waitReason?: 'resource-conflict' | 'earlier-conflict' | 'capacity' | 'owner-dispatch'; concurrencyLimit?: number; runningCount?: number; done: boolean; phase: string; processed: number; total: number; current?: string; message?: string; error?: string; elapsedSeconds?: number; exitCode?: number; cancelled?: boolean; jobId?: string; hasReport?: boolean; resultsExpired?: boolean; cleanedAt?: string; reportWarning?: string; recoveryWarnings?: string[]; task?: Task; preview?: RestorePreview | ScanPreview; summary?: JobSummary; audioResults?: AudioResult[]; audioResultCount?: number }

export interface ResultPage<T> { items: T[]; total: number; nextOffset: number | null }
