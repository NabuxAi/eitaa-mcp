// Eitaa through Eitaayar (https://eitaayar.ir/api/{token}/{method}).
// It can only post: sendMessage, sendFile and getMe. No edit, delete or reading.
// The Eitaayar account "@sender" must be an admin of the target channel.
import { callApi, formFrom, ProviderError } from '@nabuxai/iranian-messaging-core';

const API_BASE = process.env.EITAA_API_BASE || 'https://eitaayar.ir/api';

function unwrap(body) {
  if (!body?.ok) throw new ProviderError('PROVIDER_API_REJECTED', body?.description);
  return body.result;
}

const url = (ctx, method) => `${API_BASE}/${ctx.token}/${method}`;

export const eitaa = {
  id: 'eitaa',
  label: 'Eitaa (ایتا) via Eitaayar',
  tokenEnv: 'EITAA_BOT_TOKEN',
  docs: 'https://eitaayar.ir/api',
  capabilities: ['send_text', 'send_file', 'get_me'],

  async getMe(ctx) {
    const me = unwrap(await callApi(url(ctx, 'getMe'), { json: {} }, ctx.fetcher));
    return { id: me?.id != null ? String(me.id) : null, username: me?.username ?? null, name: me?.first_name ?? null };
  },

  async sendText(ctx, { chatId, text, replyToMessageId }) {
    const sent = unwrap(await callApi(url(ctx, 'sendMessage'), {
      json: { chat_id: chatId, text, ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}) }
    }, ctx.fetcher));
    return { messageId: sent?.message_id != null ? String(sent.message_id) : null };
  },

  async sendFile(ctx, { chatId, file, caption }) {
    const form = formFrom({ chat_id: chatId, caption }, { field: 'file', ...file });
    const sent = unwrap(await callApi(url(ctx, 'sendFile'), { form }, ctx.fetcher));
    return { messageId: sent?.message_id != null ? String(sent.message_id) : null };
  }
};
