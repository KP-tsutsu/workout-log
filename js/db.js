// IndexedDB のごく薄いラッパと、初回起動時に投入する種目プリセット。
//
// 記録は iPhone の中のこの DB が正本。Mac へのバックアップは sync.js が
// dump() / restore() を使って行う。

export const DB_NAME = 'workout-log';
export const DB_VERSION = 1;

export const STORES = ['settings', 'body', 'days', 'exercises', 'entries'];

export const CATEGORIES = ['胸', '背中', '脚', '肩', '腕', '体幹', '有酸素'];

export const KINDS = {
  strength: 'ウエイト',
  bodyweight: '自重',
  cardio: '有酸素',
};

// 入力項目の定義。マスタの fields はこの 5 つのキーを持つ。
export const FIELD_DEFS = [
  { key: 'weight', label: '重さ', unit: 'kg', decimals: 1 },
  { key: 'reps', label: '回数', unit: '回', decimals: 0 },
  { key: 'sets', label: 'セット数', unit: 'セット', decimals: 0 },
  { key: 'distance', label: '距離', unit: 'km', decimals: 2 },
  { key: 'duration', label: '時間', unit: '分', decimals: 0 },
];

// entries 側のプロパティ名。fields のキーと 1 対 1 で対応する。
export const FIELD_TO_PROP = {
  weight: 'weight',
  reps: 'reps',
  sets: 'sets',
  distance: 'distanceKm',
  duration: 'durationMin',
};

const OFF = { use: false, required: false, step: 1, default: null };

/** kind ごとの入力項目の既定値。マスタ編集画面の初期値にもなる。 */
export function defaultFields(kind) {
  switch (kind) {
    case 'cardio':
      return {
        weight: { ...OFF },
        reps: { ...OFF },
        sets: { ...OFF },
        // 距離が分からない日もあるので、必須は距離のみにして時間は任意。
        // 種目ごとにマスタで入れ替えられる。
        distance: { use: true, required: true, step: 0.5, default: null },
        duration: { use: true, required: false, step: 5, default: null },
      };
    case 'bodyweight':
      return {
        // 自重種目でもディップスなどで加重することがあるので、使うが必須にはしない。
        weight: { use: true, required: false, step: 2.5, default: null },
        reps: { use: true, required: true, step: 1, default: 10 },
        sets: { use: true, required: true, step: 1, default: 3 },
        distance: { ...OFF },
        duration: { ...OFF },
      };
    case 'strength':
    default:
      return {
        weight: { use: true, required: true, step: 2.5, default: null },
        reps: { use: true, required: true, step: 1, default: 10 },
        sets: { use: true, required: true, step: 1, default: 3 },
        distance: { ...OFF },
        duration: { ...OFF },
      };
  }
}

/** 保存されている fields に欠けたキーがあっても壊れないよう埋める。 */
export function normalizeFields(kind, fields) {
  const base = defaultFields(kind);
  const out = {};
  for (const { key } of FIELD_DEFS) {
    const given = (fields && fields[key]) || {};
    out[key] = {
      use: given.use !== undefined ? !!given.use : base[key].use,
      required: given.required !== undefined ? !!given.required : base[key].required,
      step: Number(given.step) > 0 ? Number(given.step) : base[key].step,
      default: given.default === undefined ? base[key].default : given.default,
    };
    // 使わない項目が必須になっていると保存できなくなるので潰しておく。
    if (!out[key].use) out[key].required = false;
  }
  return out;
}

// 時間で測る自重種目 (プランクなど) 用の上書き。
const TIMED_BODYWEIGHT = {
  weight: { ...OFF },
  reps: { ...OFF },
  sets: { use: true, required: true, step: 1, default: 3 },
  distance: { ...OFF },
  duration: { use: true, required: true, step: 1, default: 1 },
};

// [名前, カテゴリ, kind, お気に入り, fields の上書き]
const PRESETS = [
  ['ベンチプレス', '胸', 'strength', true],
  ['ダンベルプレス', '胸', 'strength', false],
  ['チェストプレス', '胸', 'strength', false],
  ['ペックフライ', '胸', 'strength', false],
  ['ディップス', '胸', 'bodyweight', false],

  ['ラットプルダウン', '背中', 'strength', true],
  ['シーテッドロー', '背中', 'strength', false],
  ['ベントオーバーロー', '背中', 'strength', false],
  ['デッドリフト', '背中', 'strength', false],
  ['チンニング', '背中', 'bodyweight', false],

  ['スクワット', '脚', 'strength', true],
  ['レッグプレス', '脚', 'strength', false],
  ['レッグエクステンション', '脚', 'strength', false],
  ['レッグカール', '脚', 'strength', false],
  ['ヒップスラスト', '脚', 'strength', false],
  ['カーフレイズ', '脚', 'strength', false],

  ['ショルダープレス', '肩', 'strength', false],
  ['サイドレイズ', '肩', 'strength', false],
  ['リアレイズ', '肩', 'strength', false],

  ['アームカール', '腕', 'strength', false],
  ['ケーブルプレスダウン', '腕', 'strength', false],

  ['アブドミナルクランチ', '体幹', 'strength', false],
  ['プランク', '体幹', 'bodyweight', false, TIMED_BODYWEIGHT],

  ['トレッドミル', '有酸素', 'cardio', true],
  ['屋外ランニング', '有酸素', 'cardio', false],
  ['エアロバイク', '有酸素', 'cardio', false],
  ['クロストレーナー', '有酸素', 'cardio', false],
  ['ローイングマシン', '有酸素', 'cardio', false],
  ['ウォーキング', '有酸素', 'cardio', false],
];

export function presetExercises() {
  return PRESETS.map(([name, category, kind, favorite, override], i) => ({
    id: 'ex_preset_' + String(i + 1).padStart(3, '0'),
    name,
    category,
    kind,
    fields: normalizeFields(kind, override),
    equipmentNote: '',
    favorite: !!favorite,
    archived: false,
    sortOrder: (i + 1) * 10,
  }));
}

export const DEFAULT_GOALS = {
  targetWeight: null,
  targetBodyFat: null,
  targetDate: null,
  startWeight: null,
  startBodyFat: null,
  startDate: null,
  height: null,
};

export const DEFAULT_PREFS = {
  lastSyncAt: null,
  lastExportAt: null,
  dashboardExerciseId: null,
};

// --- 接続 -------------------------------------------------------------------

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('body')) {
        db.createObjectStore('body', { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains('days')) {
        db.createObjectStore('days', { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains('exercises')) {
        const s = db.createObjectStore('exercises', { keyPath: 'id' });
        s.createIndex('category', 'category');
      }
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('exerciseId', 'exerciseId');
      }
      void e;
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('別のタブが古いバージョンの DB を開いています'));
  });
  return dbPromise;
}

function tx(db, stores, mode) {
  const t = db.transaction(stores, mode);
  const done = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
  return { t, done };
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- 基本操作 ---------------------------------------------------------------

export async function getAll(store) {
  const db = await openDb();
  const { t } = tx(db, [store], 'readonly');
  return wrap(t.objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await openDb();
  const { t } = tx(db, [store], 'readonly');
  const v = await wrap(t.objectStore(store).get(key));
  return v === undefined ? null : v;
}

export async function put(store, value) {
  const db = await openDb();
  const { t, done } = tx(db, [store], 'readwrite');
  t.objectStore(store).put(value);
  await done;
  return value;
}

export async function putMany(store, values) {
  if (!values.length) return;
  const db = await openDb();
  const { t, done } = tx(db, [store], 'readwrite');
  const os = t.objectStore(store);
  for (const v of values) os.put(v);
  await done;
}

export async function del(store, key) {
  const db = await openDb();
  const { t, done } = tx(db, [store], 'readwrite');
  t.objectStore(store).delete(key);
  await done;
}

export async function clear(store) {
  const db = await openDb();
  const { t, done } = tx(db, [store], 'readwrite');
  t.objectStore(store).clear();
  await done;
}

export async function byIndex(store, indexName, value) {
  const db = await openDb();
  const { t } = tx(db, [store], 'readonly');
  return wrap(t.objectStore(store).index(indexName).getAll(value));
}

export async function count(store) {
  const db = await openDb();
  const { t } = tx(db, [store], 'readonly');
  return wrap(t.objectStore(store).count());
}

// --- 設定 -------------------------------------------------------------------

export async function getGoals() {
  const row = await get('settings', 'goals');
  return { ...DEFAULT_GOALS, ...(row ? row.value : null) };
}

export async function setGoals(goals) {
  await put('settings', { key: 'goals', value: { ...DEFAULT_GOALS, ...goals } });
}

export async function getPrefs() {
  const row = await get('settings', 'prefs');
  return { ...DEFAULT_PREFS, ...(row ? row.value : null) };
}

export async function setPrefs(patch) {
  const current = await getPrefs();
  await put('settings', { key: 'prefs', value: { ...current, ...patch } });
}

// --- 初期化 -----------------------------------------------------------------

/** 種目が 1 件も無ければプリセットを入れる。投入したら true。 */
export async function seedIfEmpty() {
  if (await count('exercises')) return false;
  await putMany('exercises', presetExercises());
  return true;
}

/** 全ストアが空か。Mac のバックアップからの復元を提案するかの判定に使う。 */
export async function isEmpty() {
  const counts = await Promise.all([count('body'), count('entries'), count('days')]);
  return counts.every((n) => n === 0);
}

// --- バックアップ -----------------------------------------------------------

export async function dump() {
  const stores = {};
  for (const name of STORES) stores[name] = await getAll(name);
  return {
    app: 'workout-log',
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    stores,
  };
}

/**
 * スナップショットを書き戻す。
 * mode 'replace' は全消しして入れ替え、'merge' は同じキーのものを上書きしつつ残す。
 */
export async function restore(payload, mode = 'replace') {
  if (!payload || typeof payload !== 'object' || !payload.stores) {
    throw new Error('バックアップの形式が違います');
  }
  for (const name of STORES) {
    const rows = payload.stores[name];
    if (!Array.isArray(rows)) continue;
    if (mode === 'replace') await clear(name);
    await putMany(name, rows);
  }
}

// --- ID 生成 ----------------------------------------------------------------

export function uid(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
