// Eitaa MCP server: the official bot API and the user's own account through Eitaa Web.
import { createMessengerServer, runStdio } from '@nabuxai/iranian-messaging-core';
import { eitaa as botAdapter } from './bot.mjs';
import { eitaa as webDriver } from './web.mjs';

export { botAdapter, webDriver };
export const options = { id: 'eitaa', label: 'Eitaa', botAdapter, webDriver };
export const createServer = (extra = {}) => createMessengerServer({ ...options, ...extra });
export const start = (extra = {}) => runStdio({ ...options, ...extra });
