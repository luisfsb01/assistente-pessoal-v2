/** API local do painel sem iniciar bot nem rotinas agendadas. */
import { startWebServer } from '../api/server.js';
import { getConfig } from '../lib/config.js';

startWebServer(getConfig());
