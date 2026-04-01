// backend/utils/datetime.js

const TZ_OFFSET_MINUTES = Number(process.env.APP_TZ_OFFSET_MINUTES ?? -360); // CDMX -06 por default

// ======================================================
// Base helpers
// ======================================================

function num(v, def = 0) {
  if (v === null || v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function asValidDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isDateOnly(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(asTrim(v));
}

// ======================================================
// Local <-> UTC normalization
// ======================================================

/**
 * Convierte un Date UTC real a su representación "local del negocio"
 * usando APP_TZ_OFFSET_MINUTES, pero conservando el objeto Date.
 */
function toBusinessLocalDate(date) {
  const d = asValidDate(date);
  if (!d) return null;
  return new Date(d.getTime() + TZ_OFFSET_MINUTES * 60 * 1000);
}

/**
 * Convierte una fecha local del negocio a un Date UTC real.
 * Útil cuando ya tienes componentes locales del negocio.
 */
function fromBusinessLocalPartsToUtc(year, month, day, hh = 0, mm = 0, ss = 0, ms = 0) {
  const utcMillis = Date.UTC(year, month - 1, day, hh, mm, ss, ms);
  return new Date(utcMillis - TZ_OFFSET_MINUTES * 60 * 1000);
}

/**
 * Parsea "YYYY-MM-DD" como inicio del día local del negocio y devuelve UTC real.
 */
function dateOnlyToUtcStart(dateOnlyStr) {
  const s = asTrim(dateOnlyStr);
  if (!isDateOnly(s)) return null;

  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;

  return fromBusinessLocalPartsToUtc(y, m, d, 0, 0, 0, 0);
}

/**
 * Parsea "YYYY-MM-DD" como fin del día local del negocio y devuelve UTC real.
 */
function dateOnlyToUtcEnd(dateOnlyStr) {
  const s = asTrim(dateOnlyStr);
  if (!isDateOnly(s)) return null;

  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;

  return fromBusinessLocalPartsToUtc(y, m, d, 23, 59, 59, 999);
}

/**
 * Convierte cualquier Date válido a YYYY-MM-DD del horario local del negocio.
 */
function toYMDLocal(date) {
  const d = asValidDate(date);
  if (!d) return null;

  const local = toBusinessLocalDate(d);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Convierte cualquier Date válido a YYYY-MM del horario local del negocio.
 */
function toYMLocal(date) {
  const ymd = toYMDLocal(date);
  return ymd ? ymd.slice(0, 7) : null;
}

/**
 * Devuelve componentes locales del negocio.
 */
function getLocalParts(date) {
  const d = asValidDate(date);
  if (!d) return null;

  const local = toBusinessLocalDate(d);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hours: local.getUTCHours(),
    minutes: local.getUTCMinutes(),
    seconds: local.getUTCSeconds(),
    milliseconds: local.getUTCMilliseconds(),
  };
}

// ======================================================
// Safe parsing for input dates
// ======================================================

/**
 * Parsea una entrada de fecha de usuario:
 * - si viene ISO/date completo => respeta el instante
 * - si viene YYYY-MM-DD => la interpreta como fecha local del negocio
 */
function parseInputDateSmart(raw, fallbackNow = new Date()) {
  if (!raw) return asValidDate(fallbackNow) || new Date();

  const s = asTrim(raw);
  if (!s) return asValidDate(fallbackNow) || new Date();

  // Caso ISO completo o fecha/hora completa
  if (!isDateOnly(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? asValidDate(fallbackNow) || new Date() : d;
  }

  // Caso YYYY-MM-DD: usar la hora actual local del negocio
  const base = asValidDate(fallbackNow) || new Date();
  const localNow = toBusinessLocalDate(base);

  const [y, m, d] = s.split("-").map(Number);
  return fromBusinessLocalPartsToUtc(
    y,
    m,
    d,
    localNow.getUTCHours(),
    localNow.getUTCMinutes(),
    localNow.getUTCSeconds(),
    localNow.getUTCMilliseconds()
  );
}

/**
 * Parseo explícito para start de rango local.
 */
function parseStartDate(raw) {
  if (!raw) return null;
  const s = asTrim(raw);

  if (isDateOnly(s)) return dateOnlyToUtcStart(s);

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parseo explícito para end de rango local.
 */
function parseEndDate(raw) {
  if (!raw) return null;
  const s = asTrim(raw);

  if (isDateOnly(s)) return dateOnlyToUtcEnd(s);

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ======================================================
// Start / End of business-local periods
// ======================================================

function startOfTodayLocal(base = new Date()) {
  const parts = getLocalParts(base);
  if (!parts) return null;
  return fromBusinessLocalPartsToUtc(parts.year, parts.month, parts.day, 0, 0, 0, 0);
}

function endOfTodayLocal(base = new Date()) {
  const parts = getLocalParts(base);
  if (!parts) return null;
  return fromBusinessLocalPartsToUtc(parts.year, parts.month, parts.day, 23, 59, 59, 999);
}

function startOfMonthLocal(base = new Date()) {
  const parts = getLocalParts(base);
  if (!parts) return null;
  return fromBusinessLocalPartsToUtc(parts.year, parts.month, 1, 0, 0, 0, 0);
}

function endOfMonthLocal(base = new Date()) {
  const parts = getLocalParts(base);
  if (!parts) return null;

  const nextMonthUtc =
    parts.month === 12
      ? fromBusinessLocalPartsToUtc(parts.year + 1, 1, 1, 0, 0, 0, 0)
      : fromBusinessLocalPartsToUtc(parts.year, parts.month + 1, 1, 0, 0, 0, 0);

  return new Date(nextMonthUtc.getTime() - 1);
}

function startOfYearLocal(base = new Date()) {
  const parts = getLocalParts(base);
  if (!parts) return null;
  return fromBusinessLocalPartsToUtc(parts.year, 1, 1, 0, 0, 0, 0);
}

function endOfYearLocal(base = new Date()) {
  const parts = getLocalParts(base);
  if (!parts) return null;
  const nextYearStart = fromBusinessLocalPartsToUtc(parts.year + 1, 1, 1, 0, 0, 0, 0);
  return new Date(nextYearStart.getTime() - 1);
}

// ======================================================
// Comparators in local business time
// ======================================================

function isSameLocalDay(a, b) {
  const aa = toYMDLocal(a);
  const bb = toYMDLocal(b);
  return !!aa && !!bb && aa === bb;
}

function isSameLocalMonth(a, b) {
  const aa = toYMLocal(a);
  const bb = toYMLocal(b);
  return !!aa && !!bb && aa === bb;
}

function isSameLocalYear(a, b) {
  const pa = getLocalParts(a);
  const pb = getLocalParts(b);
  return !!pa && !!pb && pa.year === pb.year;
}

function isLocalDateOnOrAfter(a, ymdRef) {
  const aa = toYMDLocal(a);
  return !!aa && !!ymdRef && aa >= String(ymdRef);
}

function isLocalDateBetween(date, start, end) {
  const d = asValidDate(date);
  const s = asValidDate(start);
  const e = asValidDate(end);
  if (!d || !s || !e) return false;
  return d.getTime() >= s.getTime() && d.getTime() <= e.getTime();
}

// ======================================================
// Midnight UTC correction
// ======================================================

/**
 * Detecta si una fecha parece "date-only serializada como UTC"
 * ejemplo: 2026-03-30T00:00:00.000Z
 */
function isMidnightUtc(date) {
  const d = asValidDate(date);
  if (!d) return false;

  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

/**
 * Corrige una fecha que vino como medianoche UTC usando la hora de createdAt.
 * Esto ayuda muchísimo para documentos viejos o mal persistidos.
 */
function fixMidnightUtcWithCreatedAt(dateValue, createdAtValue) {
  const f = asValidDate(dateValue);
  const c = asValidDate(createdAtValue);

  if (!f && c) return c;
  if (!f) return null;
  if (!isMidnightUtc(f)) return f;
  if (!c) return f;

  return new Date(
    Date.UTC(
      f.getUTCFullYear(),
      f.getUTCMonth(),
      f.getUTCDate(),
      c.getUTCHours(),
      c.getUTCMinutes(),
      c.getUTCSeconds(),
      c.getUTCMilliseconds()
    )
  );
}

/**
 * Extrae la fecha efectiva de negocio de un documento.
 * Busca en varios campos comunes y aplica fix de medianoche UTC.
 */
function pickEffectiveDate(doc) {
  if (!doc || typeof doc !== "object") return null;

  const raw =
    doc.date ??
    doc.fecha ??
    doc.entryDate ??
    doc.asiento_fecha ??
    doc.asientoFecha ??
    doc.createdAt ??
    doc.created_at ??
    null;

  const created =
    doc.createdAt ??
    doc.created_at ??
    null;

  return fixMidnightUtcWithCreatedAt(raw, created);
}

// ======================================================
// Range helpers
// ======================================================

function buildTodayRange(base = new Date()) {
  return {
    start: startOfTodayLocal(base),
    end: endOfTodayLocal(base),
  };
}

function buildMonthRange(base = new Date()) {
  return {
    start: startOfMonthLocal(base),
    end: endOfMonthLocal(base),
  };
}

function buildYearRange(base = new Date()) {
  return {
    start: startOfYearLocal(base),
    end: endOfYearLocal(base),
  };
}

function addDays(date, days) {
  const d = asValidDate(date);
  if (!d) return null;
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

// ======================================================
// Exports
// ======================================================

module.exports = {
  TZ_OFFSET_MINUTES,

  num,
  asTrim,
  asValidDate,
  isDateOnly,

  toBusinessLocalDate,
  fromBusinessLocalPartsToUtc,
  dateOnlyToUtcStart,
  dateOnlyToUtcEnd,
  toYMDLocal,
  toYMLocal,
  getLocalParts,

  parseInputDateSmart,
  parseStartDate,
  parseEndDate,

  startOfTodayLocal,
  endOfTodayLocal,
  startOfMonthLocal,
  endOfMonthLocal,
  startOfYearLocal,
  endOfYearLocal,

  isSameLocalDay,
  isSameLocalMonth,
  isSameLocalYear,
  isLocalDateOnOrAfter,
  isLocalDateBetween,

  isMidnightUtc,
  fixMidnightUtcWithCreatedAt,
  pickEffectiveDate,

  buildTodayRange,
  buildMonthRange,
  buildYearRange,
  addDays,
};