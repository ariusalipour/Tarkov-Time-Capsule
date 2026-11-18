import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkAudit(report) {
  if (report?.error || report?.auditReportVersion !== 2 || !report.vulnerabilities ||
      typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities) ||
      !Number.isSafeInteger(report.metadata?.vulnerabilities?.total) || report.metadata.vulnerabilities.total < 0) {
    throw new Error('Missing or invalid npm audit report; refusing to pass');
  }
  const active = Object.keys(report.vulnerabilities);
  if (report.metadata.vulnerabilities.total !== active.length) {
    throw new Error('Audit totals disagree with vulnerability entries');
  }
  return { active };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = checkAudit(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    if (result.active.length) {
      console.error('Unresolved dependency findings:', result.active.join(', '));
      process.exitCode = 1;
    } else console.info('No active dependency findings in the audit report.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
