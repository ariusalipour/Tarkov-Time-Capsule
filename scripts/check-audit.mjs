import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// npm's feed can lag a withdrawal. This exception covers only this exact advisory,
// not picomatch or a severity level. Remove once npm stops reporting it.
// Verified withdrawn 2026-11-18: https://github.com/advisories/GHSA-fc5q-39xc-vjpf
const withdrawals = new Map([
  ['https://github.com/advisories/GHSA-fc5q-39xc-vjpf', Date.parse('2026-12-18T00:00:00Z')],
]);

export function checkAudit(report, now = Date.now()) {
  if (report?.error || report?.auditReportVersion !== 2 || !report.vulnerabilities ||
      typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities) ||
      !Number.isSafeInteger(report.metadata?.vulnerabilities?.total) || report.metadata.vulnerabilities.total < 0) {
    throw new Error('Missing or invalid npm audit report; refusing to pass');
  }
  const active = [], withdrawn = [];
  function excepted(name, ancestors = new Set()) {
    if (ancestors.has(name)) return false;
    const item = report.vulnerabilities[name];
    if (!Array.isArray(item?.via) || !item.via.length) return false;
    const visited = new Set([...ancestors, name]);
    return item.via.every(cause => typeof cause === 'string'
      ? excepted(cause, visited)
      : typeof cause?.url === 'string' && now < (withdrawals.get(cause.url) || 0));
  }
  for (const name of Object.keys(report.vulnerabilities)) {
    (excepted(name) ? withdrawn : active).push(name);
  }
  if (report.metadata.vulnerabilities.total !== active.length + withdrawn.length) {
    throw new Error('Audit totals disagree with vulnerability entries');
  }
  return { active, withdrawn };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = checkAudit(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    if (result.withdrawn.length) console.info('Withdrawn advisory awaiting npm feed refresh (temporary exception):', result.withdrawn.join(', '));
    if (result.active.length) {
      console.error('Unresolved dependency findings:', result.active.join(', '));
      process.exitCode = 1;
    } else console.info('No active dependency findings in the audit report.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
