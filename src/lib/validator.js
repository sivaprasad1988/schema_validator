// Generic schema.org JSON-LD validator. Pure module: no DOM, no browser APIs.
// All rules derive from the schema.org vocabulary (src/vocab.json), not from per-type lists.

const SCHEMA_PREFIXES = ['https://schema.org/', 'http://schema.org/', 'schema:'];
const SCHEMA_CONTEXT = /^https?:\/\/schema\.org(\/|\/docs\/jsonldcontext\.jsonld?)?$/;
const ABSOLUTE_IRI = /^[a-z][a-z0-9+.-]*:/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const TIME = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const MAX_LISTED = 8;

export const SEVERITIES = ['error', 'warning', 'info'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const asArray = (v) => (Array.isArray(v) ? v : [v]);
const quote = (s, max = 60) => JSON.stringify(s.length > max ? `${s.slice(0, max)}…` : s);
const list = (items) =>
  items.length > MAX_LISTED ? `${items.slice(0, MAX_LISTED).join(', ')} … (+${items.length - MAX_LISTED})` : items.join(', ');

function isValidDate(s) {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// Strips schema.org prefixes. Terms from other vocabularies are marked external and not checked.
function localName(term) {
  for (const prefix of SCHEMA_PREFIXES) {
    if (term.startsWith(prefix)) return { name: term.slice(prefix.length), external: false };
  }
  return { name: term, external: ABSOLUTE_IRI.test(term) };
}

export function isSchemaContext(ctx) {
  if (typeof ctx === 'string') return SCHEMA_CONTEXT.test(ctx.trim());
  if (Array.isArray(ctx)) return ctx.some(isSchemaContext);
  if (isObject(ctx)) return typeof ctx['@vocab'] === 'string' && SCHEMA_CONTEXT.test(ctx['@vocab'].trim());
  return false;
}

export function createValidator(vocab) {
  const { classes, props, members } = vocab;
  const classNames = Object.keys(classes);
  const propNames = Object.keys(props);
  const ancestorCache = new Map();

  // Set of the class itself plus all superclasses.
  function ancestors(name) {
    let set = ancestorCache.get(name);
    if (set) return set;
    set = new Set([name]);
    const stack = [name];
    while (stack.length) {
      for (const parent of classes[stack.pop()]?.p ?? []) {
        if (!set.has(parent)) {
          set.add(parent);
          stack.push(parent);
        }
      }
    }
    ancestorCache.set(name, set);
    return set;
  }
  const isA = (cls, target) => ancestors(cls).has(target);
  const isDataType = (cls) => [...ancestors(cls)].some((a) => classes[a]?.dt);
  const isEnumeration = (cls) => isA(cls, 'Enumeration');

  function suggest(name, pool) {
    const lower = name.toLowerCase();
    let best = null;
    let bestDistance = 3;
    for (const candidate of pool) {
      const c = candidate.toLowerCase();
      if (c === lower) return candidate;
      if (Math.abs(c.length - lower.length) >= bestDistance) continue;
      const d = levenshtein(lower, c);
      if (d < bestDistance) {
        bestDistance = d;
        best = candidate;
      }
    }
    return best;
  }

  function enumExample(enumClass) {
    const hit = Object.entries(members).find(([, m]) => m.e.includes(enumClass));
    return hit ? `https://schema.org/${hit[0]}` : null;
  }

  function validatePage(blocks) {
    const results = blocks.map((b) => ({
      index: b.index,
      location: b.location,
      data: null,
      types: [],
      issues: [],
    }));
    const defined = new Map(); // @id -> [{ pos, path }]
    const referenced = []; // { id, pos, path }

    results.forEach((res, pos) => {
      const ctx = {
        res,
        pos,
        defined,
        referenced,
        issue: (severity, path, message) => res.issues.push({ severity, path, message }),
      };
      const text = (blocks[pos].text ?? '').trim();
      if (!text) {
        ctx.issue('error', '$', 'Empty JSON-LD block.');
        return;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        ctx.issue('error', '$', `Invalid JSON: ${e.message}`);
        return;
      }
      res.data = data;

      const roots = Array.isArray(data) ? data.map((d, i) => [d, `$[${i}]`]) : [[data, '$']];
      for (const [root, path] of roots) {
        if (!isObject(root)) {
          ctx.issue('error', path, 'Top-level value must be a JSON object.');
          continue;
        }
        if (!('@context' in root)) {
          ctx.issue('error', path, 'Missing @context (expected "https://schema.org").');
        } else if (!isSchemaContext(root['@context'])) {
          ctx.issue(
            'warning',
            `${path}.@context`,
            `@context is not schema.org (${quote(JSON.stringify(root['@context']))}); vocabulary checks may be inaccurate.`,
          );
        }
        if ('@graph' in root) {
          if (!Array.isArray(root['@graph'])) {
            ctx.issue('error', `${path}.@graph`, '@graph must be an array.');
            continue;
          }
          root['@graph'].forEach((node, i) => checkTopNode(node, `${path}.@graph[${i}]`, ctx));
        } else {
          checkTopNode(root, path, ctx);
        }
      }
    });

    for (const ref of referenced) {
      if (!defined.has(ref.id)) {
        results[ref.pos].issues.push({
          severity: 'warning',
          path: ref.path,
          message: `Reference ${quote(ref.id)} is not defined in any JSON-LD block on this page.`,
        });
      }
    }
    for (const [id, defs] of defined) {
      for (const def of defs.slice(1)) {
        results[def.pos].issues.push({
          severity: 'info',
          path: def.path,
          message: `@id ${quote(id)} is defined more than once (first in block ${results[defs[0].pos].index + 1} at ${defs[0].path}). Consumers merge these nodes.`,
        });
      }
    }
    return results;
  }

  function checkTopNode(node, path, ctx) {
    if (!isObject(node)) {
      ctx.issue('error', path, 'Graph item must be a JSON object.');
      return;
    }
    if (!('@type' in node)) {
      ctx.issue('error', path, 'Top-level node has no @type.');
    }
    const { types } = checkNode(node, path, ctx);
    ctx.res.types.push(...types);
  }

  // Returns the known schema.org types of the node and whether all of its types are known.
  function checkNode(node, path, ctx) {
    const keys = Object.keys(node);
    const hasProps = keys.some((k) => !k.startsWith('@'));

    if ('@id' in node) {
      const id = node['@id'];
      if (typeof id !== 'string' || !id) {
        ctx.issue('error', `${path}.@id`, '@id must be a non-empty string.');
      } else if (hasProps || '@type' in node) {
        if (!ctx.defined.has(id)) ctx.defined.set(id, []);
        ctx.defined.get(id).push({ pos: ctx.pos, path });
      } else {
        ctx.referenced.push({ id, pos: ctx.pos, path });
      }
    }

    const types = [];
    let complete = true;
    if ('@type' in node) {
      for (const raw of asArray(node['@type'])) {
        const name = checkType(raw, `${path}.@type`, ctx);
        if (name) types.push(name);
        else complete = false;
      }
    } else {
      complete = false;
      if (hasProps && path !== '$' && !/\.@graph\[\d+\]$|^\$\[\d+\]$/.test(path)) {
        ctx.issue('warning', path, 'Object has no @type; its properties cannot be checked against a type.');
      }
    }

    for (const key of keys) {
      if (key.startsWith('@')) continue;
      checkProperty(key, node[key], types, complete, `${path}.${key}`, ctx);
    }
    return { types, complete };
  }

  function checkType(raw, path, ctx) {
    if (typeof raw !== 'string' || !raw) {
      ctx.issue('error', path, '@type must be a non-empty string.');
      return null;
    }
    const { name, external } = localName(raw);
    if (external) {
      ctx.issue('info', path, `Type ${quote(raw)} is from another vocabulary and is not checked.`);
      return null;
    }
    const cls = classes[name];
    if (!cls) {
      const hint = suggest(name, classNames);
      ctx.issue('error', path, `Unknown type ${quote(name)}.${hint ? ` Did you mean "${hint}"?` : ''}`);
      return null;
    }
    if (isDataType(name)) {
      ctx.issue('warning', path, `"${name}" is a data type, not an entity type.`);
    }
    if (cls.s) ctx.issue('warning', path, `Type "${name}" is superseded by ${cls.s.join(', ')}.`);
    if (cls.pe) ctx.issue('info', path, `Type "${name}" is in the pending area of schema.org (not yet stable).`);
    return name;
  }

  function checkProperty(key, value, types, typesComplete, path, ctx) {
    const { name, external } = localName(key);
    const prop = external ? null : props[name];

    if (!prop) {
      if (external) {
        ctx.issue('info', path, `Property ${quote(key)} is from another vocabulary and is not checked.`);
      } else {
        const hint = suggest(name, propNames);
        ctx.issue('error', path, `Unknown property ${quote(name)}.${hint ? ` Did you mean "${hint}"?` : ''}`);
      }
      // Nested objects are still checked.
      forEachValue(value, path, (v, p) => isObject(v) && checkNode(v, p, ctx));
      return;
    }

    if (prop.s) ctx.issue('warning', path, `Property "${name}" is superseded by ${prop.s.join(', ')}.`);
    if (prop.pe) ctx.issue('info', path, `Property "${name}" is in the pending area of schema.org (not yet stable).`);

    if (types.length && typesComplete && prop.d.length && !types.some((t) => prop.d.some((d) => isA(t, d)))) {
      ctx.issue(
        'warning',
        path,
        `"${name}" is not an expected property of ${types.join(', ')}. Expected on: ${list(prop.d)}.`,
      );
    }

    forEachValue(value, path, (v, p) => checkValue(v, prop, name, p, ctx));
  }

  function forEachValue(value, path, fn) {
    if (Array.isArray(value)) value.forEach((v, i) => fn(v, `${path}[${i}]`));
    else fn(value, path);
  }

  function checkValue(value, prop, name, path, ctx) {
    if (value === null) {
      ctx.issue('warning', path, 'Value is null.');
      return;
    }
    if (!isObject(value)) {
      checkLiteral(value, prop.r, name, path, ctx);
      return;
    }
    if ('@list' in value || '@set' in value) {
      const key = '@list' in value ? '@list' : '@set';
      forEachValue(value[key], `${path}.${key}`, (v, p) => checkValue(v, prop, name, p, ctx));
      return;
    }
    if ('@value' in value) {
      checkLiteral(value['@value'], prop.r, name, `${path}.@value`, ctx);
      return;
    }

    const { types, complete } = checkNode(value, path, ctx);
    if (!types.length || !complete || !prop.r.length) return;
    if (types.some((t) => isA(t, 'Role'))) return; // Role may wrap any property value.
    if (types.some((t) => prop.r.some((r) => isA(t, r)))) return;
    ctx.issue('warning', path, `"${name}" expects ${list(prop.r)}; got ${types.join(', ')}.`);
  }

  function checkLiteral(value, ranges, name, path, ctx) {
    if (!ranges.length) return;
    const has = (dt) => ranges.includes(dt);
    const textLike = ranges.some((r) => r !== 'URL' && isA(r, 'Text'));
    const numeric = ranges.some((r) => isA(r, 'Number'));
    const integerOnly = numeric && ranges.every((r) => !isA(r, 'Number') || r === 'Integer');
    const enums = ranges.filter(isEnumeration);
    const entities = ranges.filter((r) => !isDataType(r) && !isEnumeration(r));

    if (typeof value === 'boolean') {
      if (!has('Boolean')) ctx.issue('warning', path, `"${name}" expects ${list(ranges)}; got a boolean.`);
      return;
    }
    if (typeof value === 'number') {
      if (numeric) {
        if (integerOnly && !Number.isInteger(value)) ctx.issue('warning', path, `"${name}" expects an Integer.`);
      } else if (!textLike) {
        ctx.issue('warning', path, `"${name}" expects ${list(ranges)}; got a number.`);
      }
      return;
    }
    if (typeof value !== 'string') return;

    const s = value.trim();
    if (!s) {
      ctx.issue('warning', path, `"${name}" has an empty value.`);
      return;
    }
    if (textLike) return;
    if (has('URL') && checkUrl(s, path, ctx)) return;
    if (has('Date') && DATE.test(s) && isValidDate(s)) return;
    if (has('DateTime')) {
      const m = DATE_TIME.exec(s);
      if (m && isValidDate(m[1])) return;
    }
    if (has('Time') && TIME.test(s)) return;
    if (numeric && NUMERIC.test(s)) {
      if (integerOnly && !Number.isInteger(Number(s))) ctx.issue('warning', path, `"${name}" expects an Integer.`);
      return;
    }
    if (has('Boolean') && /^(true|false)$/i.test(s)) return;
    const member = members[localName(s).name];
    if (member && member.e.some((e) => ranges.some((r) => isA(e, r)))) return;

    // An absolute URL where an entity is expected identifies that entity (e.g. BreadcrumbList item).
    if (entities.length && /^https?:\/\//i.test(s)) return;

    if (entities.length) {
      ctx.issue(
        'info',
        path,
        `"${name}" expects ${list(entities)}; plain text is accepted, but a structured object is preferred.`,
      );
    } else if (enums.length) {
      const example = enumExample(enums[0]);
      ctx.issue(
        'warning',
        path,
        `Value ${quote(s)} is not a member of ${enums.join(', ')}.${example ? ` Example: "${example}".` : ''}`,
      );
    } else {
      ctx.issue('warning', path, `"${name}" expects ${list(ranges)}; got ${quote(s)}.`);
    }
  }

  // Returns true when the string is accepted as URL.
  function checkUrl(s, path, ctx) {
    if (ABSOLUTE_IRI.test(s)) {
      try {
        new URL(s);
        return true;
      } catch {
        return false;
      }
    }
    if (/^(\/|\.\.?\/)/.test(s)) {
      ctx.issue('info', path, `Relative URL ${quote(s)}; absolute URLs are recommended.`);
      return true;
    }
    return false;
  }

  return { validatePage, isA };
}
