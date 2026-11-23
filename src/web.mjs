// Eitaa Web is a fork of Telegram Web K, which exposes its MTProto managers
// at window.rootScope.managers. Calling those is far sturdier than clicking.
// The managers live in a worker behind a proxy: every call is async and its
// arguments and results are structured-cloned, so only plain data crosses.
// Message ids are the web app's "mid"s (for channels a large local number,
// not the server id), which is what readChat returns and every op accepts.
import { MAX_WEB_FILE_BYTES, evaluate } from '@nabuxai/iranian-messaging-core';

// Installed in the page before each call; runs in the browser.
function installHelpers() {
  const managers = () => window.rootScope.managers;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const nameOf = user => [user?.first_name, user?.last_name].filter(Boolean).join(' ') || null;
  window.__nabu = {
    managers,
    sleep,
    nameOf,
    async guard(body) {
      try { return await body(); } catch (error) {
        throw new Error((error && (error.type || error.message)) || String(error));
      }
    },
    // "me"/"saved" = Saved Messages; "@name" or "name" = a username;
    // a number = a peer id (channels and groups are negative, as in Telegram Web K).
    async resolve(chat) {
      const raw = String(chat).trim();
      if (/^(me|saved|self)$/i.test(raw)) return (await managers().appUsersManager.getSelf()).id;
      if (/^-?\d+$/.test(raw)) return Number(raw);
      const peer = await managers().appUsersManager.resolveUsername(raw.replace(/^@/, ''));
      if (!peer) throw new Error('CHAT_NOT_FOUND');
      return peer._ === 'user' ? peer.id : -peer.id;
    },
    mid(value) {
      const mid = Number(value);
      if (!Number.isFinite(mid) || mid <= 0) throw new Error('INVALID_MESSAGE_ID');
      return mid;
    },
    async message(peerId, mid) {
      const message = await managers().appMessagesManager.getMessageByPeer(peerId, mid);
      if (!message || message._ === 'messageEmpty' || message.deleted) return null;
      return message;
    },
    // The readChat message shape.
    shape(message) {
      return {
        messageId: String(message.mid),
        date: message.date ? new Date(message.date * 1000).toISOString() : null,
        fromId: message.fromId != null ? String(message.fromId) : null,
        outgoing: Boolean(message.pFlags?.out),
        text: message.message || null,
        media: message.media?._?.replace(/^messageMedia/, '').toLowerCase() || null,
        views: typeof message.views === 'number' ? message.views : null
      };
    },
    async shapeMids(peerId, mids) {
      const rows = await Promise.all(mids.map(async mid => {
        const message = await window.__nabu.message(peerId, mid);
        return message ? window.__nabu.shape(message) : null;
      }));
      return rows.filter(Boolean);
    },
    async chatInfo(peerId) {
      if (peerId > 0) {
        const user = await managers().appUsersManager.getUser(peerId);
        if (!user) throw new Error('CHAT_NOT_FOUND');
        return { kind: 'user', user };
      }
      const chat = await managers().appChatsManager.getChat(-peerId);
      if (!chat || chat._ === 'chatEmpty') throw new Error('CHAT_NOT_FOUND');
      return { kind: 'chat', chat, isChannel: chat._ === 'channel' || chat._ === 'channelForbidden',
        type: chat.pFlags?.broadcast ? 'channel' : 'group' };
    },
    async requireChat(chatId) {
      const peerId = await window.__nabu.resolve(chatId);
      if (peerId > 0) throw new Error('NOT_A_GROUP_OR_CHANNEL');
      const info = await window.__nabu.chatInfo(peerId);
      return { peerId, chatId: -peerId, ...info };
    },
    roleOf(chat) {
      if (!chat || chat.pFlags?.left || chat.pFlags?.kicked || /Forbidden$/.test(chat._)) return null;
      if (chat.pFlags?.creator) return 'creator';
      if (chat.admin_rights) return 'admin';
      return 'member';
    },
    async topMids(peerId) {
      const history = await managers().appMessagesManager.getHistory({ peerId, limit: 10 });
      return history.history.map(String);
    },
    // The send calls do not return the new message, so wait until messages of
    // ours that were not there before get server ids. Until then the web app
    // shows them with temporary fractional ids, and closing the window would drop them.
    async awaitNew(peerId, before, want, timeoutMs) {
      const known = new Set(before);
      // Only messages newer than what was there: older ones may just be past the window.
      const floor = Math.max(0, ...before.map(Number).filter(Number.isFinite));
      const deadline = Date.now() + timeoutMs;
      let pending = false; let done = [];
      while (Date.now() < deadline) {
        const history = await managers().appMessagesManager.getHistory({ peerId, limit: 10 + want });
        done = []; pending = false;
        for (const mid of history.history) {
          if (known.has(String(mid)) || Number(mid) <= floor) continue;
          const message = await managers().appMessagesManager.getMessageByPeer(peerId, mid);
          if (!message?.pFlags?.out && !message?.pFlags?.is_outgoing) continue;
          if (Number.isInteger(Number(mid)) && !message.pFlags?.is_outgoing) done.push(String(mid));
          else pending = true;
        }
        if (done.length >= want && !pending) break;
        await sleep(700);
      }
      return { messageIds: done.reverse(), pending };
    },
    async awaitSent(peerId, before, timeoutMs) {
      const { messageIds, pending } = await window.__nabu.awaitNew(peerId, before, 1, timeoutMs);
      return messageIds.length ? { messageId: messageIds.at(-1), pending: false } : { messageId: null, pending };
    },
    // Location, contact and poll go straight to messages.sendMedia instead of
    // the manager's sendOther: Eitaa answers a location with a different
    // random_id, so sendOther's temporary copy never resolves, and a rejected
    // send would leave a failed copy in the chat view. Calling the API leaves
    // only the server's own message, fed back through the update handler.
    async sendMedia(input, media) {
      const peerId = await window.__nabu.resolve(input.chatId);
      const random = crypto.getRandomValues(new Uint32Array(2));
      const randomId = String((BigInt(random[0] & 0x7fffffff) << 32n) | BigInt(random[1]));
      const updates = await managers().apiManager.invokeApi('messages.sendMedia', {
        peer: await managers().appPeersManager.getInputPeerById(peerId), media, message: '', random_id: randomId });
      await managers().apiUpdatesManager.processUpdateMessage(updates);
      // The server id is in the updates; the chat's mid for it is found in history.
      // (Eitaa answers a repeat of the same location with the earlier message.)
      const list = updates?.updates || (updates?.update ? [updates.update] : []);
      const serverIds = new Set(list.map(u => u.message?.id ?? (u._ === 'updateMessageID' ? u.id : undefined))
        .filter(id => id != null).map(Number));
      if (updates?._ === 'updateShortSentMessage') serverIds.add(Number(updates.id));
      for (let attempt = 0; attempt < 10 && serverIds.size; attempt++) {
        const history = await managers().appMessagesManager.getHistory({ peerId, limit: 20 });
        for (const mid of history.history) {
          const message = await managers().appMessagesManager.getMessageByPeer(peerId, mid);
          if (message && serverIds.has(Number(message.id)) && Number.isInteger(Number(mid))) {
            return { chatId: String(peerId), messageId: String(mid), pending: false };
          }
        }
        await sleep(500);
      }
      return { chatId: String(peerId), messageId: null, pending: false };
    },
    async blobBase64(blob) {
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return String(url).slice(String(url).indexOf(',') + 1);
    }
  };
}

async function inApp(page, fn, arg) {
  const ready = await page.waitForFunction(() => Boolean(window.rootScope?.managers?.appMessagesManager),
    null, { timeout: 20000 }).then(() => true, () => false);
  if (!ready) throw new Error('WEB_APP_NOT_READY_OR_NOT_SIGNED_IN');
  await evaluate(page, installHelpers);
  return evaluate(page, fn, arg);
}

export const eitaa = {
  id: 'eitaa',
  label: 'Eitaa Web',
  url: 'https://web.eitaa.com/',
  host: 'web.eitaa.com',
  chatIdHint: '"me" for Saved Messages, @username, or a numeric chatId (channels and groups are negative)',
  notes: 'Message search matches whole words only. Member lists need admin rights in channels. ' +
    'Downloads up to 20 MB. Contacts come from the account\'s Eitaa contact list (may be empty on web).',

  loginState(page) {
    return page.evaluate(async () => {
      const managers = window.rootScope?.managers;
      if (managers?.appUsersManager) {
        try {
          const self = await managers.appUsersManager.getSelf();
          if (self?.id) return { signedIn: true, userId: String(self.id), name: [self.first_name, self.last_name].filter(Boolean).join(' ') };
        } catch { /* not signed in yet */ }
      }
      const text = document.body?.innerText || '';
      const step = /کد تأیید|کد\n/.test(text) ? 'waiting_for_code'
        : /رمز عبور|Password/i.test(text) ? 'waiting_for_password'
          : /شماره تلفن|Phone/i.test(text) ? 'waiting_for_phone' : 'loading';
      return { signedIn: false, step };
    });
  },

  async loginStart(page, digits) {
    const field = page.locator('.input-field-input[contenteditable]').nth(1);
    await field.waitFor({ timeout: 20000 });
    await field.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('+98' + digits, { delay: 30 });
    await page.locator('button.btn-primary').first().click();
  },

  listChats(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const { dialogs, count } = await managers.dialogsStorage.getDialogs({ filterId: 0, limit: input.limit });
      const rows = await Promise.all(dialogs.map(async dialog => {
        const peerId = dialog.peerId;
        let title = null; let username = null; let type = 'user'; let canPost = true;
        if (peerId < 0) {
          const chat = await managers.appChatsManager.getChat(-peerId);
          title = chat?.title ?? null; username = chat?.username ?? null;
          type = chat?.pFlags?.broadcast ? 'channel' : 'group';
          canPost = type === 'group' || Boolean(chat?.pFlags?.creator || chat?.admin_rights);
        } else {
          const user = await managers.appUsersManager.getUser(peerId);
          title = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || null;
          username = user?.username ?? null;
          type = user?.pFlags?.bot ? 'bot' : 'user';
        }
        return { chatId: String(peerId), title, username, type, unread: dialog.unread_count || 0, canPost };
      }));
      return { total: count ?? null, chats: rows };
    }), arg);
  },

  // getHistory only reads; it never marks the chat read (that is readHistory).
  readChat(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const peerId = await window.__nabu.resolve(input.chatId);
      const history = await managers.appMessagesManager.getHistory({
        peerId, limit: input.limit, ...(input.before ? { offsetId: Number(input.before) } : {})
      });
      const messages = await window.__nabu.shapeMids(peerId, history.history);
      const last = history.history.at(-1);
      return { chatId: String(peerId), messages,
        nextBeforeMessageId: history.isEnd || last == null ? null : String(last) };
    }), arg);
  },

  sendText(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const peerId = await window.__nabu.resolve(input.chatId);
      const before = await window.__nabu.topMids(peerId);
      await window.__nabu.managers().appMessagesManager.sendText({ peerId, text: input.text,
        ...(input.replyToMessageId ? { replyToMsgId: window.__nabu.mid(input.replyToMessageId) } : {}) });
      const sent = await window.__nabu.awaitSent(peerId, before, 20000);
      return { chatId: String(peerId), ...sent };
    }), arg);
  },

  sendFile(page, { chatId, file, caption }) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const peerId = await window.__nabu.resolve(input.chatId);
      const bytes = Uint8Array.from(atob(input.base64), c => c.charCodeAt(0));
      const blob = new File([bytes], input.name, { type: input.mime });
      const isMedia = /^(image|video)\//.test(input.mime);
      const before = await window.__nabu.topMids(peerId);
      await window.__nabu.managers().appMessagesManager.sendFile({ peerId, file: blob, caption: input.caption, isMedia });
      const sent = await window.__nabu.awaitSent(peerId, before, 120000);
      return { chatId: String(peerId), ...sent };
    }), { chatId, base64: Buffer.from(file.bytes).toString('base64'), name: file.name, mime: file.mime, caption });
  },

  // ---- message operations ----

  editText(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const peerId = await window.__nabu.resolve(input.chatId);
      const message = await window.__nabu.message(peerId, window.__nabu.mid(input.messageId));
      if (!message) throw new Error('MESSAGE_NOT_FOUND');
      await window.__nabu.managers().appMessagesManager.editMessage(message, input.text);
      return { edited: true };
    }), arg);
  },

  deleteMessages(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const peerId = await window.__nabu.resolve(input.chatId);
      // In a channel or supergroup without the delete right the web app silently
      // skips messages that are not ours, so apply the same rule up front and
      // count only what is really sent for deletion.
      let ownOnly = false;
      if (peerId < 0) {
        const chat = await managers.appChatsManager.getChat(-peerId);
        ownOnly = chat?._ === 'channel' && !chat.pFlags?.creator && !chat.admin_rights?.pFlags?.delete_messages;
      }
      const mids = [];
      for (const id of input.messageIds) {
        const mid = window.__nabu.mid(id);
        const message = await window.__nabu.message(peerId, mid);
        if (message && (!ownOnly || message.pFlags?.out)) mids.push(mid);
      }
      if (!mids.length) throw new Error(ownOnly ? 'MESSAGES_NOT_FOUND_OR_NOT_YOURS' : 'MESSAGES_NOT_FOUND');
      // Resolves once the server has deleted them; the chat view catches up a few seconds later.
      await managers.appMessagesManager.deleteMessages(peerId, mids, input.forEveryone);
      return { deleted: mids.length };
    }), arg);
  },

  forwardMessages(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const fromPeerId = await window.__nabu.resolve(input.fromChatId);
      const peerId = await window.__nabu.resolve(input.toChatId);
      const mids = [];
      for (const id of input.messageIds) {
        const mid = window.__nabu.mid(id);
        if (!(await window.__nabu.message(fromPeerId, mid))) throw new Error('MESSAGE_NOT_FOUND: ' + id);
        mids.push(mid);
      }
      const before = await window.__nabu.topMids(peerId);
      await managers.appMessagesManager.forwardMessages({ peerId, fromPeerId, mids });
      const { messageIds } = await window.__nabu.awaitNew(peerId, before, mids.length, 20000);
      return { chatId: String(peerId), messageIds };
    }), arg);
  },

  pinMessage(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const peerId = await window.__nabu.resolve(input.chatId);
      // Eitaa pins only in groups and channels, with the pin right; in private
      // chats (Saved Messages too) the server accepts the call and does nothing.
      if (peerId > 0) throw new Error('PIN_ONLY_IN_GROUPS_AND_CHANNELS_ON_EITAA');
      if (!(await managers.appPeersManager.canPinMessage(peerId))) throw new Error('CHAT_ADMIN_REQUIRED');
      const mid = window.__nabu.mid(input.messageId);
      if (!(await window.__nabu.message(peerId, mid))) throw new Error('MESSAGE_NOT_FOUND');
      // (peerId, mid, unpin, silent, pm_oneside)
      await managers.appMessagesManager.updatePinnedMessage(peerId, mid, input.unpin, true, false);
      return { pinned: !input.unpin };
    }), arg);
  },

  // The same call as the chat list's "Mark as read".
  markRead(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const peerId = await window.__nabu.resolve(input.chatId);
      const dialog = await managers.appMessagesManager.getDialogOnly(peerId);
      if (!dialog) throw new Error('CHAT_NOT_IN_DIALOG_LIST');
      if (dialog.unread_count || dialog.pFlags?.unread_mark) {
        await managers.appMessagesManager.markDialogUnread({ peerId, read: true });
      }
      return { read: true };
    }), arg);
  },

  sendLocation(page, arg) {
    return inApp(page, input => window.__nabu.guard(() => window.__nabu.sendMedia(input,
      { _: 'inputMediaGeoPoint', geo_point: { _: 'inputGeoPoint', lat: input.latitude, long: input.longitude } })), arg);
  },

  sendContact(page, arg) {
    return inApp(page, input => window.__nabu.guard(() => window.__nabu.sendMedia(input,
      { _: 'inputMediaContact', phone_number: input.phone, first_name: input.firstName, last_name: input.lastName || '', vcard: '' })), arg);
  },

  // The server refuses polls in private chats and Saved Messages (MEDIA_INVALID).
  sendPoll(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => window.__nabu.sendMedia(input, {
      _: 'inputMediaPoll',
      poll: {
        _: 'poll', id: '0', question: input.question,
        pFlags: { ...(input.anonymous ? {} : { public_voters: true }), ...(input.multipleAnswers ? { multiple_choice: true } : {}) },
        answers: input.options.map((text, index) => ({ _: 'pollAnswer', text, option: new Uint8Array([index]) }))
      }
    })), arg);
  },

  // ---- reading ----

  getChatInfo(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const peerId = await window.__nabu.resolve(input.chatId);
      const info = await window.__nabu.chatInfo(peerId);
      if (info.kind === 'user') {
        const full = await managers.appProfileManager.getProfile(peerId).catch(() => null);
        return { chatId: String(peerId), title: window.__nabu.nameOf(info.user), username: info.user.username || null,
          type: info.user.pFlags?.bot ? 'bot' : 'user', description: full?.about || null, memberCount: null, role: null };
      }
      const full = await managers.appProfileManager.getChatFull(-peerId).catch(() => null);
      return { chatId: String(peerId), title: info.chat.title ?? null, username: info.chat.username || null, type: info.type,
        description: full?.about || null,
        memberCount: full?.participants_count ?? full?.participants?.participants?.length ?? info.chat.participants_count ?? null,
        role: window.__nabu.roleOf(info.chat) };
    }), arg);
  },

  getMembers(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const { chatId, chat } = await window.__nabu.requireChat(input.chatId);
      const filter = input.query ? { _: 'channelParticipantsSearch', q: input.query } : { _: 'channelParticipantsRecent' };
      const result = await managers.appProfileManager.getParticipants({ id: chatId, filter, limit: input.limit });
      const roles = { channelParticipantCreator: 'creator', chatParticipantCreator: 'creator',
        channelParticipantAdmin: 'admin', chatParticipantAdmin: 'admin' };
      const list = (result.participants || []).slice(0, input.limit);
      const members = await Promise.all(list.map(async participant => {
        const userId = participant.user_id ?? participant.peer?.user_id;
        const user = userId ? await managers.appUsersManager.getUser(userId) : null;
        return { userId: userId != null ? String(userId) : null, name: window.__nabu.nameOf(user), username: user?.username || null,
          role: roles[participant._] || 'member' };
      }));
      // Eitaa reports count as the page size, so prefer the chat's member count.
      let total = result.count ?? null;
      if (!input.query) {
        const full = await managers.appProfileManager.getChatFull(chatId).catch(() => null);
        total = full?.participants_count ?? chat.participants_count ?? total ?? members.length;
      }
      return { total, members };
    }), arg);
  },

  // In one chat: messages.search. Across chats: Eitaa's own messages.searchGlobalExt
  // with the "my chats" scope (flag 65536), the same call as the web app's search page.
  // Eitaa matches whole words only.
  searchMessages(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      if (input.chatId) {
        const peerId = await window.__nabu.resolve(input.chatId);
        const result = await managers.appMessagesManager.getHistory({ peerId, query: input.query,
          inputFilter: { _: 'inputMessagesFilterEmpty' }, limit: input.limit });
        const messages = await window.__nabu.shapeMids(peerId, result.history.slice(0, input.limit));
        return { total: result.count ?? null, messages: messages.map(m => ({ ...m, chatId: String(peerId) })) };
      }
      const result = await managers.appMessagesManager.searchGlobalExt({ flags: 65536, q: input.query,
        offset_date: 0, offset_peer: 0, offset_id: 0, limit: input.limit });
      const messages = [];
      for (const hit of result.history.slice(0, input.limit)) {
        const message = await window.__nabu.message(hit.peerId, hit.mid);
        if (message) messages.push({ ...window.__nabu.shape(message), chatId: String(hit.peerId) });
      }
      return { total: result.count ?? null, messages };
    }), arg);
  },

  downloadMedia(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const peerId = await window.__nabu.resolve(input.chatId);
      const mid = window.__nabu.mid(input.messageId);
      const message = await window.__nabu.message(peerId, mid);
      if (!message) throw new Error('MESSAGE_NOT_FOUND');
      const media = message.media;
      let options; let name; let mime; let size;
      if (media?.photo?._ === 'photo') {
        const sizes = (media.photo.sizes || []).filter(s => s._ === 'photoSize' || s._ === 'photoSizeProgressive');
        const thumb = sizes.sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
        if (!thumb) throw new Error('NO_DOWNLOADABLE_MEDIA');
        options = { media: media.photo, thumb };
        name = `photo-${mid}.jpg`; mime = 'image/jpeg';
        size = thumb.size ?? (thumb.sizes ? thumb.sizes.at(-1) : 0);
      } else if (media?.document?._ === 'document') {
        const doc = media.document;
        const fileAttr = (doc.attributes || []).find(a => a._ === 'documentAttributeFilename');
        name = fileAttr?.file_name || doc.file_name || `file-${mid}`; mime = doc.mime_type || 'application/octet-stream';
        size = Number(doc.size) || 0;
        options = { media: doc };
      } else {
        throw new Error('NO_DOWNLOADABLE_MEDIA');
      }
      if (size > input.maxBytes) throw new Error('FILE_TOO_LARGE');
      const blob = await managers.apiFileManager.downloadMedia(options);
      if (!blob || typeof blob.size !== 'number') throw new Error('DOWNLOAD_FAILED');
      if (blob.size > input.maxBytes) throw new Error('FILE_TOO_LARGE');
      return { name, mime: mime || blob.type, base64: await window.__nabu.blobBase64(blob) };
    }), { ...arg, maxBytes: MAX_WEB_FILE_BYTES });
  },

  // Dialogs with unread messages and their newest unread ones. getHistory does
  // not mark anything read.
  getUnread(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const { dialogs } = await managers.dialogsStorage.getDialogs({ filterId: 0, limit: 200 });
      const selfId = (await managers.appUsersManager.getSelf()).id;
      const unread = dialogs.filter(d => d.unread_count > 0 || d.pFlags?.unread_mark).slice(0, input.limit);
      const chats = [];
      for (const dialog of unread) {
        const peerId = dialog.peerId;
        const info = await window.__nabu.chatInfo(peerId).catch(() => null);
        const title = info?.kind === 'user' ? window.__nabu.nameOf(info.user) : info?.chat?.title ?? null;
        const take = Math.min(Math.max(dialog.unread_count || 1, 1), 5);
        const history = await managers.appMessagesManager.getHistory({ peerId, limit: take });
        const messages = await window.__nabu.shapeMids(peerId, history.history.slice(0, take));
        chats.push({ chatId: String(peerId), title, unread: dialog.unread_count || 0,
          messages: peerId === selfId ? messages : messages.filter(m => !m.outgoing) });
      }
      return { chats };
    }), arg);
  },

  // Phone numbers are never returned.
  getContacts(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const ids = await managers.appUsersManager.getContacts(input.query || undefined, false, 'name');
      const contacts = await Promise.all(ids.slice(0, input.limit).map(async userId => {
        const user = await managers.appUsersManager.getUser(userId);
        return { userId: String(userId), name: window.__nabu.nameOf(user), username: user?.username || null };
      }));
      return { total: ids.length, contacts };
    }), arg);
  },

  // ---- chat management ----

  // An empty group is a supergroup (what the web app itself creates when no
  // members are picked); basic groups need at least one member up front.
  createChat(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const chatId = await managers.appChatsManager.createChannel({
        ...(input.type === 'channel' ? { broadcast: true } : { megagroup: true }), title: input.title, about: input.about || '' });
      return { chatId: String(-chatId), title: input.title, type: input.type };
    }), arg);
  },

  updateChat(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const { chatId } = await window.__nabu.requireChat(input.chatId);
      if (input.title !== undefined) await managers.appChatsManager.editTitle(chatId, input.title);
      if (input.about !== undefined) await managers.appChatsManager.editAbout(chatId, input.about);
      return { updated: true };
    }), arg);
  },

  // A public chat's address, else its existing invite link; an admin without
  // one gets a link made the same way the web app's "Invite link" screen does.
  getInviteLink(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const { chatId, chat } = await window.__nabu.requireChat(input.chatId);
      if (chat.username) return { link: `https://eitaa.com/${chat.username}` };
      const full = await managers.appProfileManager.getChatFull(chatId).catch(() => null);
      if (full?.exported_invite?.link) return { link: full.exported_invite.link };
      if (!window.__nabu.roleOf(chat) || window.__nabu.roleOf(chat) === 'member') throw new Error('NO_INVITE_LINK_AND_NOT_ADMIN');
      return { link: await managers.appProfileManager.getChatInviteLink(chatId) };
    }), arg);
  },

  // An invite link (eitaa.com/joinchat/<hash>) or a public @username / eitaa.com/<name>.
  joinChat(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const raw = input.link.trim();
      const invite = raw.match(/(?:joinchat\/|\/\+|^\+)([\w-]+)\/?$/i);
      let chatId;
      if (invite) {
        chatId = await managers.appChatsManager.importChatInvite(invite[1]);
      } else {
        const name = raw.replace(/^https?:\/\/(?:www\.)?eitaa\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
        if (!/^\w{3,64}$/.test(name)) throw new Error('INVALID_LINK');
        const peer = await managers.appUsersManager.resolveUsername(name);
        if (!peer || peer._ === 'user') throw new Error('NOT_A_GROUP_OR_CHANNEL');
        if (peer._ !== 'channel') throw new Error('ONLY_PUBLIC_CHANNELS_AND_GROUPS_CAN_BE_JOINED_BY_NAME');
        await managers.appChatsManager.joinChannel(peer.id);
        chatId = peer.id;
      }
      const chat = await managers.appChatsManager.getChat(chatId);
      return { chatId: String(-chatId), title: chat?.title ?? null };
    }), arg);
  },

  leaveChat(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const { chatId } = await window.__nabu.requireChat(input.chatId);
      await window.__nabu.managers().appChatsManager.leave(chatId);
      return { left: true };
    }), arg);
  },

  addMembers(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const { chatId } = await window.__nabu.requireChat(input.chatId);
      const userIds = input.userIds.map(id => {
        const n = Number(id);
        if (!Number.isInteger(n) || n <= 0) throw new Error('INVALID_USER_ID: ' + id);
        return n;
      });
      for (const userId of userIds) {
        if (!(await managers.appUsersManager.getUser(userId))) throw new Error('UNKNOWN_USER_OPEN_A_CHAT_WITH_THEM_FIRST: ' + userId);
      }
      await managers.appChatsManager.addToChat(chatId, userIds);
      return { added: userIds.length };
    }), arg);
  },

  // Without ban the user is removed and unbanned again, so they may rejoin.
  removeMember(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const { chatId, isChannel } = await window.__nabu.requireChat(input.chatId);
      const userId = Number(input.userId);
      if (!Number.isInteger(userId) || userId <= 0) throw new Error('INVALID_USER_ID');
      await managers.appChatsManager.kickFromChat(chatId, userId);
      if (isChannel && !input.ban) {
        await managers.appChatsManager.editBanned(chatId, userId, { _: 'chatBannedRights', until_date: 0, pFlags: {} });
      }
      return { removed: true };
    }), arg);
  },

  // Basic groups use messages.editChatAdmin directly: the manager's editAdmin
  // would first convert a basic group into a supergroup.
  setAdmin(page, arg) {
    return inApp(page, input => window.__nabu.guard(async () => {
      const managers = window.__nabu.managers();
      const { chatId, isChannel, type } = await window.__nabu.requireChat(input.chatId);
      const userId = Number(input.userId);
      if (!Number.isInteger(userId) || userId <= 0) throw new Error('INVALID_USER_ID');
      if (!(await managers.appUsersManager.getUser(userId))) throw new Error('UNKNOWN_USER');
      if (!isChannel) {
        await managers.apiManager.invokeApi('messages.editChatAdmin', {
          chat_id: chatId, user_id: await managers.appUsersManager.getUserInput(userId), is_admin: input.isAdmin });
        return { updated: true };
      }
      const rights = !input.isAdmin ? {} : type === 'channel'
        ? { change_info: true, post_messages: true, edit_messages: true, delete_messages: true, invite_users: true }
        : { change_info: true, delete_messages: true, ban_users: true, invite_users: true, pin_messages: true };
      await managers.appChatsManager.editAdmin(chatId, userId, { _: 'chatAdminRights', pFlags: rights }, '');
      return { updated: true };
    }), arg);
  }
};
