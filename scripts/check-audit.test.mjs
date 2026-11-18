import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAudit } from './check-audit.mjs';

const withdrawn = { url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' };
const report = vulnerabilities => ({ auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: { total: Object.keys(vulnerabilities).length } } });
const now = Date.parse('2026-11-18T12:00:00Z');

test('only the withdrawn advisory and exclusively affected parents are excepted', () => {
  assert.deepEqual(checkAudit(report({ picomatch: { via: [withdrawn] }, vite: { via: ['picomatch'] } }), now), { active: [], withdrawn: ['picomatch', 'vite'] });
});
test('a new advisory on the same package fails, including its parents', () => {
  const result = checkAudit(report({ picomatch: { via: [withdrawn, { url: 'https://github.com/advisories/GHSA-new' }] }, vite: { via: ['picomatch'] } }), now);
  assert.deepEqual(result.active, ['picomatch', 'vite']);
});
test('exception expires and malformed, missing and cyclic causes fail closed', () => {
  assert.deepEqual(checkAudit(report({ picomatch: { via: [withdrawn] } }), Date.parse('2026-12-18')).active, ['picomatch']);
  assert.deepEqual(checkAudit(report({ a: { via: ['b'] }, b: { via: ['a'] }, c: { via: ['absent'] } }), now).active, ['a', 'b', 'c']);
  assert.throws(() => checkAudit({ error: { code: 'ENETWORK' } }), /invalid/);
  assert.throws(() => checkAudit({ auditReportVersion: 2, vulnerabilities: [], metadata: { vulnerabilities: { total: 0 } } }), /invalid/);
  assert.throws(() => checkAudit({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 2 } } }), /disagree/);
  assert.deepEqual(checkAudit(report({}), now), { active: [], withdrawn: [] });
});
