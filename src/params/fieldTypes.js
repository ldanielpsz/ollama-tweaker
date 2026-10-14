// Field-type strategies: how a raw UI/API value is validated, and how it maps to/from an env var.
// parse() returns undefined for "empty" (not provided); it throws on invalid input.
const isEmpty = (v) => v === undefined || v === null || v === '';
const DURATION_RE = /^(-?\d+|(\d+(\.\d+)?(ns|us|ms|s|m|h))+)$/;
const fail = (f, msg) => { throw new Error(`${f.key} ${msg}`); };

const num = (v, f, integer) => {
  if (isEmpty(v)) return undefined;
  const n = Number(v);
  const min = f.min ?? (integer ? 0 : undefined);
  const ok = Number.isFinite(n) && (!integer || Number.isInteger(n))
    && (min === undefined || n >= min) && (f.max === undefined || n <= f.max);
  if (!ok) {
    const range = [min !== undefined && `>= ${min}`, f.max !== undefined && `<= ${f.max}`].filter(Boolean).join(' and ');
    fail(f, `must be ${integer ? 'an integer' : 'a number'}${range ? ' ' + range : ''}`);
  }
  return n;
};

const text = {
  parse: (v) => (isEmpty(v) ? undefined : String(v).trim() || undefined),
  fromEnv: (s) => s,
  toEnv: (v) => String(v),
};

module.exports = {
  int: { parse: (v, f) => num(v, f, true), fromEnv: Number, toEnv: String },
  number: { parse: (v, f) => num(v, f, false), fromEnv: Number, toEnv: String },
  text,
  // 5m, 24h, 0, -1. Bare integers are returned as numbers: Ollama's request API only accepts -1 as a number.
  duration: {
    parse(v, f) {
      const s = text.parse(v);
      if (s === undefined) return undefined;
      if (!DURATION_RE.test(s)) fail(f, 'must look like 5m, 24h, 0 or -1');
      return /^-?\d+$/.test(s) ? Number(s) : s;
    },
    fromEnv: (s) => s,
    toEnv: (v) => String(v),
  },
  select: {
    parse(v, f) {
      if (isEmpty(v)) return undefined;
      const allowed = (f.options || []).map((o) => String(o.value));
      if (!allowed.includes(String(v))) fail(f, `must be one of: ${allowed.filter(Boolean).join(', ')}`);
      return f.cast === 'number' ? Number(v) : String(v);
    },
    fromEnv: (s) => s,
    toEnv: (v) => String(v),
  },
  // '', 'true', 'false' -> undefined | true | false
  tribool: {
    parse(v, f) {
      if (isEmpty(v)) return undefined;
      if (v === true || v === 'true') return true;
      if (v === false || v === 'false') return false;
      return fail(f, 'must be true or false');
    },
    fromEnv: (s) => !['0', 'false', ''].includes(s),
    toEnv: (v) => (v ? '1' : '0'),
  },
  bool: {
    parse: (v) => (v === undefined ? undefined : v === true || v === 'true' || v === '1'),
    fromEnv: (s) => !['0', 'false', ''].includes(s),
    toEnv: (v) => (v ? '1' : '0'),
  },
  // comma separated text or an array -> array of non-empty strings
  list: {
    parse(v) {
      if (isEmpty(v)) return undefined;
      const a = (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);
      return a.length ? a : undefined;
    },
    fromEnv: (s) => s.split(',').filter(Boolean),
    toEnv: (v) => v.join(','),
  },
};
