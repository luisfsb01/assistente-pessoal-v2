import { google, type calendar_v3 } from 'googleapis';
import type { Config } from './config.js';

export function hasGoogleCreds(cfg: Config): boolean {
  return Boolean(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET && cfg.GOOGLE_REFRESH_TOKEN);
}

export function getCalendarClient(cfg: Config): calendar_v3.Calendar {
  if (!hasGoogleCreds(cfg)) throw new Error('credenciais Google ausentes');
  const auth = new google.auth.OAuth2(cfg.GOOGLE_CLIENT_ID, cfg.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: cfg.GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth });
}
