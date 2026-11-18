export const TRANSFER_FORMAT = 'yami-account-transfer';
export const TRANSFER_VERSION = 1;
export const TRANSFER_STORAGE_KEYS = [
  'career-flow-data-v5',
  'careerflow-theme',
  'careerflow-last-manual-theme',
  'careerflow-locale',
  'careerflow-custom-icon',
  'yami-last-main-view',
  'careerflow-home-region',
  'careerflow-company-stage-filter',
  'careerflow-company-sort',
  'careerflow-last-export',
  'yami-product-update-read-ids',
] as const;

export type TransferAsset = {
  kind: 'attachments' | 'backups';
  id: string;
  mediaType: string;
  size: number;
  sha256: string;
  contentBase64: string;
};
export type TransferPackage = {
  format: typeof TRANSFER_FORMAT;
  version: typeof TRANSFER_VERSION;
  createdAt: string;
  fingerprint: string;
  storage: Record<string, string>;
  assets: TransferAsset[];
};

const safeKeys = new Set<string>(TRANSFER_STORAGE_KEYS);
const encoder = new TextEncoder();
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
export const sha256Hex = async (bytes: Uint8Array | string) => {
  const input = typeof bytes === 'string' ? encoder.encode(bytes) : bytes;
  const inputBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', inputBuffer));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
};
export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [];
}
function normalizeLegacyData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_TRANSFER_DATA');
  const data = value as Record<string, unknown>;
  const companies = asRecords(data.companies);
  const materials = asRecords(data.materials);
  return {
    ...data,
    schemaVersion: 5,
    companies: companies.map((company) => ({
      ...company,
      interestLevel: company.interestLevel || 3,
      tags: Array.isArray(company.tags) ? company.tags : [],
      color: company.color || '#555555',
    })),
    materials: materials.map((material) => ({
      ...material,
      tags: Array.isArray(material.tags) ? material.tags : [],
      isWeeklyFocus: Boolean(material.isWeeklyFocus),
    })),
    events: asRecords(data.events),
    interviews: asRecords(data.interviews),
    preparations: asRecords(data.preparations),
    templates: asRecords(data.templates ?? (data.settings as Record<string, unknown> | undefined)?.templates),
    focusMinutes: Number(data.focusMinutes) || 0,
  };
}
function backupToStorage(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_BACKUP');
  const backup = value as Record<string, unknown>;
  if (![5, '5', 'v5'].includes(backup.schemaVersion as never)) throw new Error('UNSUPPORTED_BACKUP_VERSION');
  const settings = backup.settings && typeof backup.settings === 'object' ? backup.settings as Record<string, unknown> : {};
  const data = normalizeLegacyData({
    schemaVersion: 5,
    companies: backup.companies,
    events: backup.schedules,
    materials: backup.resources,
    interviews: backup.interviews,
    preparations: backup.preparations,
    preferences: settings.preferences,
    templates: settings.templates,
  });
  for (const selection of asRecords(backup.selectionRecords)) {
    const company = (data.companies as Record<string, unknown>[]).find((item) => item.id === selection.id);
    if (company && !company.stage && typeof selection.stage === 'string') company.stage = selection.stage;
  }
  const storage: Record<string, string> = { 'career-flow-data-v5': JSON.stringify(data) };
  if (settings.theme === 'light' || settings.theme === 'dark' || settings.theme === 'system') storage['careerflow-theme'] = settings.theme;
  if (settings.locale === 'ja' || settings.locale === 'zh') storage['careerflow-locale'] = settings.locale;
  return storage;
}

export function normalizeTransfer(raw: unknown): Omit<TransferPackage, 'fingerprint' | 'createdAt'> & { fingerprint?: string; createdAt?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_TRANSFER');
  const value = raw as Record<string, unknown>;
  if (value.format !== TRANSFER_FORMAT || value.version !== TRANSFER_VERSION) {
    return { format: TRANSFER_FORMAT, version: TRANSFER_VERSION, storage: backupToStorage(raw), assets: [] };
  }
  if (!value.storage || typeof value.storage !== 'object' || Array.isArray(value.storage) || !Array.isArray(value.assets)) throw new Error('INVALID_TRANSFER');
  const storage: Record<string, string> = {};
  for (const [key, item] of Object.entries(value.storage as Record<string, unknown>)) {
    if (!safeKeys.has(key) || typeof item !== 'string') throw new Error('INVALID_TRANSFER_STORAGE');
    storage[key] = item;
  }
  if (!storage['career-flow-data-v5'] && typeof value.storage === 'object') throw new Error('TRANSFER_HAS_NO_WORKSPACE');
  const data = normalizeLegacyData(JSON.parse(storage['career-flow-data-v5']));
  storage['career-flow-data-v5'] = JSON.stringify(data);
  const assets = (value.assets as unknown[]).map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new Error('INVALID_TRANSFER_ASSET');
    const asset = candidate as Record<string, unknown>;
    if ((asset.kind !== 'attachments' && asset.kind !== 'backups') || typeof asset.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(asset.id) || typeof asset.mediaType !== 'string' || typeof asset.contentBase64 !== 'string') throw new Error('INVALID_TRANSFER_ASSET');
    const bytes = decodeBase64(asset.contentBase64);
    if (bytes.byteLength !== asset.size || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('INVALID_TRANSFER_ASSET');
    return { kind: asset.kind, id: asset.id, mediaType: asset.mediaType.slice(0, 100), size: bytes.byteLength, sha256: asset.sha256, contentBase64: asset.contentBase64 } as TransferAsset;
  });
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    fingerprint: typeof value.fingerprint === 'string' ? value.fingerprint : undefined,
    storage,
    assets,
  };
}

export async function transferFingerprint(storage: Record<string, string>, assets: TransferAsset[]) {
  const manifest = assets.map(({ kind, id, size, sha256 }) => ({ kind, id, size, sha256 })).sort((a, b) => `${a.kind}/${a.id}`.localeCompare(`${b.kind}/${b.id}`));
  return sha256Hex(stable({ storage, manifest }));
}

export async function buildTransferPackage(storage: Record<string, string>, assets: TransferAsset[], createdAt = new Date().toISOString()): Promise<TransferPackage> {
  const cleanStorage = Object.fromEntries(Object.entries(storage).filter(([key, value]) => safeKeys.has(key) && typeof value === 'string'));
  if (!cleanStorage['career-flow-data-v5']) throw new Error('TRANSFER_HAS_NO_WORKSPACE');
  const data = normalizeLegacyData(JSON.parse(cleanStorage['career-flow-data-v5']));
  cleanStorage['career-flow-data-v5'] = JSON.stringify(data);
  const cleanAssets = assets.map((asset) => ({ ...asset }));
  return { format: TRANSFER_FORMAT, version: TRANSFER_VERSION, createdAt, fingerprint: await transferFingerprint(cleanStorage, cleanAssets), storage: cleanStorage, assets: cleanAssets };
}

function openExistingDb(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let absent = false;
    request.onupgradeneeded = (event) => {
      if ((event as IDBVersionChangeEvent).oldVersion === 0) {
        absent = true;
        request.transaction?.abort();
      }
    };
    request.onsuccess = () => {
      if (absent) { request.result.close(); resolve(null); }
      else resolve(request.result);
    };
    request.onerror = () => {
      if (absent || request.error?.name === 'AbortError') resolve(null);
      else reject(request.error ?? new Error('INDEXED_DB_READ_FAILED'));
    };
  });
}
async function readStore(name: string, store: string): Promise<{ keys: IDBValidKey[]; values: unknown[] }> {
  const db = await openExistingDb(name);
  if (!db) return { keys: [], values: [] };
  if (!db.objectStoreNames.contains(store)) { db.close(); return { keys: [], values: [] }; }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly');
    const objectStore = transaction.objectStore(store);
    const keysRequest = objectStore.getAllKeys(), valuesRequest = objectStore.getAll();
    transaction.oncomplete = () => { resolve({ keys: keysRequest.result, values: valuesRequest.result }); db.close(); };
    transaction.onerror = () => { reject(transaction.error ?? new Error('INDEXED_DB_READ_FAILED')); db.close(); };
  });
}
async function blobAsset(kind: TransferAsset['kind'], id: string, blob: Blob, mediaType = blob.type || 'application/octet-stream'): Promise<TransferAsset> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { kind, id, mediaType, size: bytes.byteLength, sha256: await sha256Hex(bytes), contentBase64: encodeBase64(bytes) };
}

export async function exportLegacyAccountTransfer(storage: Storage = globalThis.localStorage): Promise<TransferPackage> {
  const selected: Record<string, string> = {};
  for (const key of TRANSFER_STORAGE_KEYS) {
    const value = storage.getItem(key);
    if (value !== null) selected[key] = value;
  }
  if (!selected['career-flow-data-v5']) {
    const old = storage.getItem('career-flow-data-v4');
    if (old) selected['career-flow-data-v5'] = JSON.stringify(normalizeLegacyData(JSON.parse(old)));
  }
  if (!selected['career-flow-data-v5']) selected['career-flow-data-v5'] = JSON.stringify(normalizeLegacyData({}));
  const attachments = await readStore('careerflow-attachments', 'files');
  const assets: TransferAsset[] = [];
  for (let index = 0; index < attachments.keys.length; index++) {
    const key = attachments.keys[index];
    const value = attachments.values[index];
    if (value instanceof Blob) assets.push(await blobAsset('attachments', String(key), value));
  }
  const backups = await readStore('careerflow-backups', 'backup-store');
  for (let index = 0; index < backups.values.length; index++) {
    const record = backups.values[index];
    if (!record || typeof record !== 'object') continue;
    const id = String(backups.keys[index] ?? (record as { createdAt?: number }).createdAt ?? `legacy-${index}`);
    const bytes = encoder.encode(JSON.stringify(record));
    assets.push({ kind: 'backups', id, mediaType: 'application/json', size: bytes.byteLength, sha256: await sha256Hex(bytes), contentBase64: encodeBase64(bytes) });
  }
  const oldBackup = storage.getItem('career-flow-pre-v5-backup');
  if (oldBackup) {
    const bytes = encoder.encode(JSON.stringify({ format: 'yami-legacy-backup', version: 4, raw: oldBackup }));
    assets.push({ kind: 'backups', id: 'legacy-pre-v5', mediaType: 'application/json', size: bytes.byteLength, sha256: await sha256Hex(bytes), contentBase64: encodeBase64(bytes) });
  }
  const available = new Set(assets.filter((asset) => asset.kind === 'attachments').map((asset) => asset.id));
  const active = JSON.parse(selected['career-flow-data-v5']) as { materials?: { attachmentId?: string }[] };
  const referenced = new Set((active.materials ?? []).map((item) => item.attachmentId).filter((value): value is string => Boolean(value)));
  for (const backup of backups.values) {
    if (!backup || typeof backup !== 'object') continue;
    const snapshot = backup as { resources?: { attachmentId?: string }[] };
    for (const resource of snapshot.resources ?? []) if (resource.attachmentId) referenced.add(resource.attachmentId);
  }
  const missing = [...referenced].filter((id) => !available.has(id));
  if (missing.length) throw new Error(`MISSING_LEGACY_ATTACHMENTS:${missing.length}`);
  return buildTransferPackage(selected, assets);
}
