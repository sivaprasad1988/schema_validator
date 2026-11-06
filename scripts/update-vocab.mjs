#!/usr/bin/env node
// Downloads the current schema.org vocabulary and writes a compact lookup file to src/vocab.json.
// The extension never loads the vocabulary at runtime (MV3: no remote code, offline use).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://schema.org/version/latest/schemaorg-current-https.jsonld';
const OUT = fileURLToPath(new URL('../src/vocab.json', import.meta.url));

const ids = (value) =>
  (value == null ? [] : Array.isArray(value) ? value : [value]).map((v) => (typeof v === 'object' ? v['@id'] : v));
const local = (id) => (typeof id === 'string' && id.startsWith('schema:') ? id.slice('schema:'.length) : null);
const locals = (value) => ids(value).map(local).filter(Boolean);

const response = await fetch(SOURCE);
if (!response.ok) {
  throw new Error(`Download failed: ${response.status} ${response.statusText}`);
}
const graph = (await response.json())['@graph'];

const classes = {};
const props = {};
const members = {};

for (const node of graph) {
  const name = local(node['@id']);
  if (!name) continue;

  const types = ids(node['@type']);
  const meta = {};
  const supersededBy = locals(node['schema:supersededBy']);
  if (supersededBy.length) meta.s = supersededBy;
  if (ids(node['schema:isPartOf']).some((u) => u.includes('pending.schema.org'))) meta.pe = 1;

  if (types.includes('rdfs:Class')) {
    classes[name] = { p: locals(node['rdfs:subClassOf']), ...meta };
    if (types.includes('schema:DataType')) classes[name].dt = 1;
  } else if (types.includes('rdf:Property')) {
    props[name] = {
      d: locals(node['schema:domainIncludes']),
      r: locals(node['schema:rangeIncludes']),
      ...meta,
    };
  }

  // Enumeration members are typed with their enumeration class, e.g. InStock -> ItemAvailability.
  const enumTypes = locals(types).filter((t) => t !== 'DataType');
  if (enumTypes.length) members[name] = { e: enumTypes, ...meta };
}

const vocab = {
  source: SOURCE,
  generated: new Date().toISOString().slice(0, 10),
  classes,
  props,
  members,
};

writeFileSync(OUT, JSON.stringify(vocab));
console.log(
  `Wrote ${OUT}: ${Object.keys(classes).length} classes, ${Object.keys(props).length} properties, ` +
    `${Object.keys(members).length} enumeration members.`,
);
