// 日付・数値まわりの小道具と、トレーニング指標の計算。
//
// 日付はすべて端末ローカル時刻の 'YYYY-MM-DD' 文字列で扱う。Date を跨ぐと
// タイムゾーンで前日にずれる事故が起きるため、文字列を正としている。

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Date → 'YYYY-MM-DD' (ローカル時刻) */
export function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM-DD' → Date (ローカル時刻の 0 時) */
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today() {
  return toDateStr(new Date());
}

export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function addMonths(dateStr, n) {
  const d = parseDate(dateStr);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  // 1/31 の 1 か月後が 3/3 にならないよう、月末に丸める。
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toDateStr(d);
}

export function daysBetween(a, b) {
  const ms = parseDate(b).getTime() - parseDate(a).getTime();
  return Math.round(ms / 86400000);
}

export function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

/** 月曜始まりの週の頭を返す。 */
export function startOfWeek(dateStr) {
  const d = parseDate(dateStr);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return toDateStr(d);
}

export function startOfMonth(dateStr) {
  return dateStr.slice(0, 7) + '-01';
}

export function endOfMonth(dateStr) {
  const d = parseDate(dateStr);
  return toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** '8月18日(月)' */
export function formatDateJa(dateStr, opts = {}) {
  const d = parseDate(dateStr);
  const w = WEEKDAY_JA[d.getDay()];
  const head = opts.withYear ? `${d.getFullYear()}年` : '';
  return `${head}${d.getMonth() + 1}月${d.getDate()}日(${w})`;
}

/** 今日・昨日は言葉で、それ以外は日付で。 */
export function formatDateRelative(dateStr) {
  const diff = daysBetween(dateStr, today());
  if (diff === 0) return '今日';
  if (diff === 1) return '昨日';
  if (diff === -1) return '明日';
  return formatDateJa(dateStr, { withYear: parseDate(dateStr).getFullYear() !== new Date().getFullYear() });
}

export function weekdayJa(dateStr) {
  return WEEKDAY_JA[parseDate(dateStr).getDay()];
}

/** ISO 文字列 → '8月18日 21:03'。null なら '—'。 */
export function formatStamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// --- 数値 -------------------------------------------------------------------

export function round(n, decimals = 1) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** 数値を小数桁付きで。null/NaN は '—'。 */
export function fmt(n, decimals = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return round(n, decimals).toFixed(decimals);
}

/** 末尾の 0 を落として表示する (72 / 72.5 / 8.9)。 */
export function fmtTrim(n, decimals = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return String(round(n, decimals));
}

/** 符号付き差分。目標との差など。 */
export function fmtSigned(n, decimals = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const r = round(n, decimals);
  return (r > 0 ? '+' : '') + String(r);
}

/** 分 → '1時間5分' / '45分'。 */
export function fmtMinutes(min) {
  if (min === null || min === undefined || Number.isNaN(min)) return '—';
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}時間${m}分`;
  if (h) return `${h}時間`;
  return `${m}分`;
}

/** 分/km → "5'30""。 */
export function fmtPace(minPerKm) {
  if (!minPerKm || !Number.isFinite(minPerKm)) return '—';
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  const mm = s === 60 ? m + 1 : m;
  const ss = s === 60 ? 0 : s;
  return `${mm}'${pad2(ss)}"`;
}

/** 文字列入力 → 数値 or null。空欄と数値でない入力を null に寄せる。 */
export function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// --- トレーニング指標 --------------------------------------------------------

/** 1 行のボリューム (重さ × 回数 × セット数)。重量が無い種目は 0。 */
export function entryVolume(entry) {
  const w = entry.weight;
  const r = entry.reps;
  const s = entry.sets || 1;
  if (!w || !r) return 0;
  return w * r * s;
}

/** 推定 1RM (Epley)。重量と回数が揃っている時だけ。 */
export function estimate1RM(weight, reps) {
  if (!weight || !reps) return null;
  return weight * (1 + reps / 30);
}

/** 有酸素 1 行の平均ペース (分/km)。 */
export function entryPace(entry) {
  if (!entry.distanceKm || !entry.durationMin) return null;
  return entry.durationMin / entry.distanceKm;
}

/** 配列を key ごとにまとめる。 */
export function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const k = keyFn(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

export function sum(rows, valueFn) {
  let total = 0;
  for (const row of rows) total += valueFn(row) || 0;
  return total;
}

/**
 * 日付順に並んだ [{date, value}] へ移動平均を足す。
 * 日付の欠けは詰めたまま、直近 windowDays 日以内の点だけで平均する。
 */
export function movingAverage(points, windowDays = 7) {
  return points.map((p, i) => {
    const from = addDays(p.date, -(windowDays - 1));
    let total = 0;
    let n = 0;
    for (let j = i; j >= 0; j--) {
      if (points[j].date < from) break;
      total += points[j].value;
      n++;
    }
    return { date: p.date, value: total / n };
  });
}
