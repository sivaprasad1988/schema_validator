import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createValidator, buildItems, issueInItem } from '../src/lib/validator.js';

const vocab = JSON.parse(readFileSync(new URL('../src/vocab.json', import.meta.url), 'utf8'));
const { validatePage } = createValidator(vocab);

const CTX = 'https://schema.org';
const run = (...docs) =>
  validatePage(docs.map((d, index) => ({ index, location: 'head', text: typeof d === 'string' ? d : JSON.stringify(d) })));
const issues = (...docs) => run(...docs).flatMap((r) => r.issues);
const has = (list, severity, pattern) => list.some((i) => i.severity === severity && pattern.test(i.message));

test('valid Organization has no errors or warnings', () => {
  const list = issues({
    '@context': CTX,
    '@type': 'Organization',
    name: 'Gingco Communication',
    url: 'https://www.gingco.de/',
    logo: 'https://www.gingco.de/logo.png',
  });
  assert.deepEqual(list.filter((i) => i.severity !== 'info'), []);
});

test('invalid JSON is an error', () => {
  assert.ok(has(issues('{"@context": "https://schema.org",'), 'error', /Invalid JSON/));
});

test('empty block is an error', () => {
  assert.ok(has(issues('   '), 'error', /Empty JSON-LD/));
});

test('missing @context is an error', () => {
  assert.ok(has(issues({ '@type': 'Thing', name: 'x' }), 'error', /Missing @context/));
});

test('foreign @context is a warning', () => {
  assert.ok(has(issues({ '@context': 'https://example.org', '@type': 'Thing' }), 'warning', /not schema\.org/));
});

test('schema.org context variants are accepted', () => {
  for (const ctx of ['http://schema.org', 'https://schema.org/', { '@vocab': 'https://schema.org/' }]) {
    assert.ok(!has(issues({ '@context': ctx, '@type': 'Thing' }), 'warning', /@context/), JSON.stringify(ctx));
  }
});

test('unknown type gets a suggestion', () => {
  assert.ok(has(issues({ '@context': CTX, '@type': 'Organisation' }), 'error', /Unknown type "Organisation"\. Did you mean "Organization"/));
});

test('prefixed and full IRI types are resolved', () => {
  const list = issues({ '@context': CTX, '@type': ['schema:Organization', 'https://schema.org/LocalBusiness'] });
  assert.deepEqual(list, []);
});

test('unknown property gets a suggestion', () => {
  assert.ok(has(issues({ '@context': CTX, '@type': 'Article', headlin: 'x' }), 'error', /Did you mean "headline"/));
});

test('property on wrong type is a warning', () => {
  assert.ok(has(issues({ '@context': CTX, '@type': 'Organization', headline: 'x' }), 'warning', /not an expected property of Organization/));
});

test('inherited property is accepted', () => {
  // name is defined on Thing; NewsArticle -> Article -> CreativeWork -> Thing
  assert.deepEqual(issues({ '@context': CTX, '@type': 'NewsArticle', name: 'x', headline: 'y' }), []);
});

test('superseded type is a warning', () => {
  assert.ok(has(issues({ '@context': CTX, '@type': 'Code' }), 'warning', /superseded by SoftwareSourceCode/));
});

test('top-level node without @type is an error', () => {
  assert.ok(has(issues({ '@context': CTX, name: 'x' }), 'error', /no @type/));
});

test('dates are checked', () => {
  const bad = issues({ '@context': CTX, '@type': 'Article', datePublished: '06.11.2026' });
  assert.ok(has(bad, 'warning', /"datePublished" expects/));
  const good = issues({ '@context': CTX, '@type': 'Article', datePublished: '2026-11-06', dateModified: '2026-11-06T13:18:00+01:00' });
  assert.deepEqual(good, []);
  assert.ok(has(issues({ '@context': CTX, '@type': 'Article', datePublished: '2026-02-30' }), 'warning', /datePublished/));
});

test('enumeration values are checked', () => {
  const offer = (availability) => ({ '@context': CTX, '@type': 'Offer', availability });
  assert.deepEqual(issues(offer('https://schema.org/InStock')), []);
  assert.deepEqual(issues(offer('InStock')), []);
  assert.ok(has(issues(offer('Available')), 'warning', /not a member of ItemAvailability/));
});

test('text where an entity is expected is info only', () => {
  const list = issues({ '@context': CTX, '@type': 'Article', author: 'Max Mustermann' });
  assert.ok(has(list, 'info', /"author" expects/));
  assert.ok(!list.some((i) => i.severity !== 'info'));
});

test('object of wrong type is a warning', () => {
  const list = issues({ '@context': CTX, '@type': 'Article', author: { '@type': 'Place', name: 'Berlin' } });
  assert.ok(has(list, 'warning', /"author" expects .*got Place/));
});

test('URL values are checked', () => {
  assert.ok(has(issues({ '@context': CTX, '@type': 'Thing', url: 'not a url' }), 'warning', /"url" expects URL/));
  assert.ok(has(issues({ '@context': CTX, '@type': 'Thing', url: '/relative' }), 'info', /Relative URL/));
});

test('@graph references resolve, dangling references are info (as on validator.schema.org)', () => {
  const graph = {
    '@context': CTX,
    '@graph': [
      { '@type': 'Organization', '@id': 'https://example.org/#org', name: 'Org' },
      { '@type': 'WebSite', '@id': 'https://example.org/#web', publisher: { '@id': 'https://example.org/#org' } },
      { '@type': 'WebPage', isPartOf: { '@id': 'https://example.org/#missing' } },
    ],
  };
  const list = issues(graph);
  assert.ok(has(list, 'info', /#missing.*not defined/));
  assert.ok(!list.some((i) => /#org/.test(i.message)));
});

test('references resolve across blocks', () => {
  const list = issues(
    { '@context': CTX, '@type': 'Organization', '@id': '#org', name: 'Org' },
    { '@context': CTX, '@type': 'WebSite', publisher: { '@id': '#org' } },
  );
  assert.deepEqual(list, []);
});

test('typical FAQPage is clean', () => {
  const list = issues({
    '@context': CTX,
    '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer', text: 'A.' } },
    ],
  });
  assert.deepEqual(list, []);
});

test('BreadcrumbList with position numbers is clean', () => {
  const list = issues({
    '@context': CTX,
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.org/' },
      { '@type': 'ListItem', position: '2', name: 'News', item: 'https://example.org/news/' },
    ],
  });
  assert.deepEqual(list, []);
});

test('top-level types are collected per block', () => {
  const [result] = run({ '@context': CTX, '@graph': [{ '@type': 'Organization' }, { '@type': 'WebSite' }] });
  assert.deepEqual(result.types, ['Organization', 'WebSite']);
});

// Expected output taken from validator.schema.org (checked 2026-11-06 with this input).
test('items merge nodes by @id and nest referenced nodes like validator.schema.org', () => {
  const doc = {
    '@context': 'https://schema.org/',
    '@graph': [
      { '@type': 'Organization', '@id': 'https://example.com/#org', logo: 'https://example.com/logo.svg', name: 'Example Org', sameAs: ['https://www.facebook.com/example'], url: 'https://example.com/' },
      {
        '@type': 'WebSite',
        '@id': 'https://example.com/#website',
        name: 'Example Site',
        publisher: { '@type': 'Organization', '@id': 'https://example.com/#org', name: 'Example Org', url: 'https://example.com/' },
        author: { '@id': 'https://example.com/#missing' },
        url: 'https://example.com/',
      },
    ],
  };
  const results = run(doc);
  assert.ok(!results[0].issues.some((i) => i.severity !== 'info'));
  assert.ok(!results[0].issues.some((i) => /more than once/.test(i.message)));
  const items = buildItems(results);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].data, {
    '@type': 'WebSite',
    '@id': 'https://example.com/#website',
    name: 'Example Site',
    url: 'https://example.com/',
    publisher: {
      '@type': 'Organization',
      '@id': 'https://example.com/#org',
      logo: 'https://example.com/logo.svg',
      name: 'Example Org',
      sameAs: 'https://www.facebook.com/example',
      url: 'https://example.com/',
    },
    author: { '@type': 'Thing', '@id': 'https://example.com/#missing' },
  });
});

test('items merge across blocks and attribute issues to the item', () => {
  const results = run(
    { '@context': CTX, '@type': 'WebPage', '@id': '#page', publisher: { '@id': '#org' } },
    { '@context': CTX, '@type': 'Organization', '@id': '#org', name: 'Org', foo: 1 },
  );
  const items = buildItems(results);
  assert.equal(items.length, 1);
  assert.equal(items[0].data.publisher.name, 'Org');
  const own = results.flatMap((r, pos) => r.issues.filter((i) => issueInItem(items[0], pos, i.path)));
  assert.ok(own.some((i) => /foo/.test(i.message)));
});

test('unreferenced top-level nodes are separate items, cycles terminate', () => {
  const items = buildItems(
    run({
      '@context': CTX,
      '@graph': [
        { '@type': 'Person', '@id': '#a', knows: { '@id': '#b' } },
        { '@type': 'Person', '@id': '#b', knows: { '@id': '#a' } },
        { '@type': 'Thing', name: 'Loose' },
      ],
    }),
  );
  assert.deepEqual(items.map((i) => i.data.name), ['Loose']);
});
