// 読み込んだデータのメモリ上の写しと、変更通知。
//
// 数年分でも数千行にしかならないので、全件をメモリに載せて集計は都度計算する。
// 書き込みは必ずこのモジュール経由にして、IndexedDB とメモリのずれを防ぐ。

import * as db from './db.js';
import { entryVolume, estimate1RM, today } from './util.js';

const state = {
  ready: false,
  exercises: [],
  entries: [],
  body: [],
  days: [],
  goals: { ...db.DEFAULT_GOALS },
  prefs: { ...db.DEFAULT_PREFS },
};

const listeners = new Set();

/** 変更のたびに呼ばれる。戻り値で購読を解除できる。 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(reason) {
  for (const fn of listeners) {
    try {
      fn(reason);
    } catch (e) {
      console.error('リスナーでエラー', e);
    }
  }
}

export function getState() {
  return state;
}

export async function load() {
  await db.openDb();
  await db.seedIfEmpty();
  await reload();
  state.ready = true;
  emit('load');
}

/** DB から全件読み直す。復元やインポートの後に使う。 */
export async function reload() {
  const [exercises, entries, body, days, goals, prefs] = await Promise.all([
    db.getAll('exercises'),
    db.getAll('entries'),
    db.getAll('body'),
    db.getAll('days'),
    db.getGoals(),
    db.getPrefs(),
  ]);
  state.exercises = exercises.sort(byExerciseOrder);
  state.entries = entries.sort(byEntryOrder);
  state.body = body.sort((a, b) => (a.date < b.date ? -1 : 1));
  state.days = days;
  state.goals = goals;
  state.prefs = prefs;
}

function byExerciseOrder(a, b) {
  const ca = db.CATEGORIES.indexOf(a.category);
  const cb = db.CATEGORIES.indexOf(b.category);
  if (ca !== cb) return ca - cb;
  if (a.sortOrder !== b.sortOrder) return (a.sortOrder || 0) - (b.sortOrder || 0);
  return a.name.localeCompare(b.name, 'ja');
}

function byEntryOrder(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.order || 0) - (b.order || 0);
}

// --- 体組成 -----------------------------------------------------------------

export function bodyForDate(date) {
  return state.body.find((b) => b.date === date) || null;
}

/**
 * 体重か体脂肪率のどちらかがあれば保存、両方空なら削除する。
 * silent を立てると通知を出さない。入力中の画面が作り直されてフォーカスが
 * 飛ぶのを避けるため、記録画面からの自動保存はこちらを使う。
 */
export async function saveBody({ date, weight, bodyFat, note }, { silent = false } = {}) {
  const hasValue = weight !== null || bodyFat !== null || (note || '').trim() !== '';
  if (!hasValue) {
    const existed = state.body.some((b) => b.date === date);
    if (existed) await deleteBody(date, { silent });
    return null;
  }
  const row = { date, weight, bodyFat, note: note || '', updatedAt: new Date().toISOString() };
  await db.put('body', row);
  const i = state.body.findIndex((b) => b.date === date);
  if (i >= 0) state.body[i] = row;
  else state.body.push(row);
  state.body.sort((a, b) => (a.date < b.date ? -1 : 1));
  emit(silent ? 'body-quiet' : 'body');
  return row;
}

export async function deleteBody(date, { silent = false } = {}) {
  await db.del('body', date);
  state.body = state.body.filter((b) => b.date !== date);
  emit(silent ? 'body-quiet' : 'body');
}

/**
 * 進捗バーの起点。設定画面で明示されていればそれを、無ければ最初の記録を使う。
 * 値を保存せず都度求めているのは、あとから古い記録を入れ直したときに
 * 起点が古いままにならないようにするため。
 */
export function startValue(key) {
  const goalKey = key === 'weight' ? 'startWeight' : 'startBodyFat';
  if (state.goals[goalKey] !== null && state.goals[goalKey] !== undefined) return state.goals[goalKey];
  const series = bodySeries(key);
  return series.length ? series[0].value : null;
}

/** 体重・体脂肪率それぞれの、値がある点だけの時系列。 */
export function bodySeries(key) {
  return state.body
    .filter((b) => b[key] !== null && b[key] !== undefined)
    .map((b) => ({ date: b.date, value: b[key] }));
}

export function latestBody(key) {
  const series = bodySeries(key);
  return series.length ? series[series.length - 1] : null;
}

// --- 日メモ -----------------------------------------------------------------

export function dayForDate(date) {
  return state.days.find((d) => d.date === date) || null;
}

export async function saveDay(date, note) {
  if (!(note || '').trim()) {
    await db.del('days', date);
    state.days = state.days.filter((d) => d.date !== date);
  } else {
    const row = { date, note: note.trim() };
    await db.put('days', row);
    const i = state.days.findIndex((d) => d.date === date);
    if (i >= 0) state.days[i] = row;
    else state.days.push(row);
  }
  emit('days');
}

// --- 種目マスタ -------------------------------------------------------------

export function exerciseById(id) {
  return state.exercises.find((e) => e.id === id) || null;
}

export function exerciseName(id) {
  const ex = exerciseById(id);
  return ex ? ex.name : '(削除された種目)';
}

export function activeExercises() {
  return state.exercises.filter((e) => !e.archived);
}

export async function saveExercise(input) {
  const existing = input.id ? exerciseById(input.id) : null;
  const kind = input.kind || 'strength';
  const row = {
    id: input.id || db.uid('ex'),
    name: (input.name || '').trim(),
    category: input.category || '胸',
    kind,
    fields: db.normalizeFields(kind, input.fields),
    equipmentNote: (input.equipmentNote || '').trim(),
    favorite: !!input.favorite,
    archived: !!input.archived,
    sortOrder: existing ? existing.sortOrder : nextSortOrder(input.category),
  };
  await db.put('exercises', row);
  const i = state.exercises.findIndex((e) => e.id === row.id);
  if (i >= 0) state.exercises[i] = row;
  else state.exercises.push(row);
  state.exercises.sort(byExerciseOrder);
  emit('exercises');
  return row;
}

function nextSortOrder(category) {
  const inCat = state.exercises.filter((e) => e.category === category);
  return inCat.reduce((max, e) => Math.max(max, e.sortOrder || 0), 0) + 10;
}

export async function toggleFavorite(id) {
  const ex = exerciseById(id);
  if (!ex) return;
  await saveExercise({ ...ex, favorite: !ex.favorite });
}

/** 実績がある種目は消さずに非表示にする。実績ゼロなら本当に消す。 */
export async function deleteExercise(id) {
  const used = state.entries.some((e) => e.exerciseId === id);
  if (used) {
    const ex = exerciseById(id);
    if (ex) await saveExercise({ ...ex, archived: true });
    return 'archived';
  }
  await db.del('exercises', id);
  state.exercises = state.exercises.filter((e) => e.id !== id);
  emit('exercises');
  return 'deleted';
}

// --- トレーニング実績 --------------------------------------------------------

export function entriesForDate(date) {
  return state.entries.filter((e) => e.date === date).sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function entriesForExercise(exerciseId) {
  return state.entries.filter((e) => e.exerciseId === exerciseId);
}

export async function saveEntry(input) {
  const isNew = !input.id;
  const row = {
    id: input.id || db.uid('en'),
    date: input.date,
    exerciseId: input.exerciseId,
    order: input.order !== undefined ? input.order : nextEntryOrder(input.date),
    weight: input.weight ?? null,
    reps: input.reps ?? null,
    sets: input.sets ?? null,
    distanceKm: input.distanceKm ?? null,
    durationMin: input.durationMin ?? null,
    memo: (input.memo || '').trim(),
    createdAt: input.createdAt || new Date().toISOString(),
  };
  await db.put('entries', row);
  const i = state.entries.findIndex((e) => e.id === row.id);
  if (i >= 0) state.entries[i] = row;
  else state.entries.push(row);
  state.entries.sort(byEntryOrder);
  emit(isNew ? 'entry-add' : 'entry-edit');
  return row;
}

function nextEntryOrder(date) {
  const same = state.entries.filter((e) => e.date === date);
  return same.reduce((max, e) => Math.max(max, e.order || 0), 0) + 10;
}

export async function deleteEntry(id) {
  await db.del('entries', id);
  state.entries = state.entries.filter((e) => e.id !== id);
  emit('entry-delete');
}

/** その種目の直近の記録。入力欄のプリフィルに使う。 */
export function lastEntryForExercise(exerciseId, beforeDate = null) {
  const rows = state.entries
    .filter((e) => e.exerciseId === exerciseId && (!beforeDate || e.date <= beforeDate))
    .sort(byEntryOrder);
  return rows.length ? rows[rows.length - 1] : null;
}

/** 最近使った種目の ID を新しい順に。 */
export function recentExerciseIds(limit = 8) {
  const seen = [];
  for (let i = state.entries.length - 1; i >= 0 && seen.length < limit; i--) {
    const id = state.entries[i].exerciseId;
    if (!seen.includes(id) && exerciseById(id)) seen.push(id);
  }
  return seen;
}

/** トレーニングをした日付の集合。 */
export function trainingDates() {
  return new Set(state.entries.map((e) => e.date));
}

export function volumeByDate() {
  const map = new Map();
  for (const e of state.entries) {
    map.set(e.date, (map.get(e.date) || 0) + entryVolume(e));
  }
  return map;
}

/** ある種目の自己ベスト。まだ記録が無ければ null。 */
export function personalBests(exerciseId) {
  const rows = entriesForExercise(exerciseId);
  if (!rows.length) return null;
  let maxWeight = null;
  let max1RM = null;
  let maxVolume = null;
  let maxDistance = null;
  for (const e of rows) {
    if (e.weight !== null && (maxWeight === null || e.weight > maxWeight.value)) {
      maxWeight = { value: e.weight, date: e.date };
    }
    const rm = estimate1RM(e.weight, e.reps);
    if (rm !== null && (max1RM === null || rm > max1RM.value)) {
      max1RM = { value: rm, date: e.date };
    }
    const vol = entryVolume(e);
    if (vol > 0 && (maxVolume === null || vol > maxVolume.value)) {
      maxVolume = { value: vol, date: e.date };
    }
    if (e.distanceKm !== null && (maxDistance === null || e.distanceKm > maxDistance.value)) {
      maxDistance = { value: e.distanceKm, date: e.date };
    }
  }
  return { maxWeight, max1RM, maxVolume, maxDistance };
}

/** この行が自己ベスト更新かどうか (同じ種目の、この行より前の記録との比較)。 */
export function isPersonalRecord(entry) {
  const prior = entriesForExercise(entry.exerciseId).filter(
    (e) => e.id !== entry.id && (e.date < entry.date || (e.date === entry.date && (e.order || 0) < (entry.order || 0))),
  );
  if (!prior.length) return false;
  const rm = estimate1RM(entry.weight, entry.reps);
  if (rm !== null) {
    const best = Math.max(...prior.map((e) => estimate1RM(e.weight, e.reps) || 0));
    return rm > best;
  }
  if (entry.distanceKm) {
    const best = Math.max(...prior.map((e) => e.distanceKm || 0));
    return entry.distanceKm > best;
  }
  return false;
}

// --- 目標・設定 -------------------------------------------------------------

export async function saveGoals(patch, { silent = false } = {}) {
  state.goals = { ...state.goals, ...patch };
  await db.setGoals(state.goals);
  emit(silent ? 'goals-quiet' : 'goals');
}

export async function savePrefs(patch) {
  state.prefs = { ...state.prefs, ...patch };
  await db.setPrefs(patch);
  emit('prefs');
}

/**
 * prefs のうち同期時刻のように「変更通知を起こしたくない」ものを静かに更新する。
 * これを emit すると同期 → prefs 更新 → 同期… と回り続けてしまう。
 */
export async function savePrefsQuiet(patch) {
  state.prefs = { ...state.prefs, ...patch };
  await db.setPrefs(patch);
}

// --- 復元 -------------------------------------------------------------------

export async function restoreFrom(payload, mode = 'replace') {
  await db.restore(payload, mode);
  await db.seedIfEmpty();
  await reload();
  emit('restore');
}

export function todayStr() {
  return today();
}
