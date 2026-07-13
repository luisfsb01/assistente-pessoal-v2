import { getConfig } from '../lib/config.js';
import { getCalendarClient, hasGoogleCreds } from '../lib/google.js';

const cfg = getConfig();
if (!hasGoogleCreds(cfg)) {
  console.error('Defina GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN no .env');
  process.exit(1);
}
const cal = getCalendarClient(cfg);
const { data } = await cal.calendarList.list();
for (const c of data.items ?? []) {
  console.log(`${c.summary}  →  ${c.id}${c.primary ? '  (primary)' : ''}`);
}
