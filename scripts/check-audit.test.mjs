import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAudit } from './check-audit.mjs';
const report = vulnerabilities => ({ auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: { total: Object.keys(vulnerabilities).length } } });

test('every finding is active, including the formerly excepted advisory', () => {
  assert.deepEqual(checkAudit(report({ picomatch: { via: [{ url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' }] }, vite: { via: ['picomatch'] } })).active, ['picomatch', 'vite']);
});
test('malformed reports and inconsistent counts fail closed', () => {
  assert.throws(() => checkAudit({ error: { code: 'ENETWORK' } }), /invalid/);
  assert.throws(() => checkAudit({ auditReportVersion: 2, vulnerabilities: [], metadata: { vulnerabilities: { total: 0 } } }), /invalid/);
  assert.throws(() => checkAudit({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 2 } } }), /disagree/);
});
test('a clean audit passes without exceptions', () => {
  assert.deepEqual(checkAudit(report({})), { active: [] });
});
