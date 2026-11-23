# Eitaa MCP (ایتا)

[![npm](https://img.shields.io/npm/v/@nabuxai/eitaa-mcp)](https://www.npmjs.com/package/@nabuxai/eitaa-mcp) [![CI](https://github.com/NabuxAi/eitaa-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/NabuxAi/eitaa-mcp/actions/workflows/ci.yml) ![license](https://img.shields.io/badge/license-MIT-blue)

یک سرور MCP برای پیام‌رسان ایتا، تا دستیار هوش مصنوعی (Claude، Cursor، ChatGPT و …) بتواند پیام بخواند و بفرستد. دو حالت دارد:

- **حالت بات** — ربات از طریق API «ایتایار» (eitaayar.ir): فقط ارسال متن و فایل به کانالی که `@sender` در آن ادمین است. توکن از پنل ایتایار (پولی).
- **حالت وب (اکانت خودتان)** — Eitaa Web در یک پنجره‌ی Chrome محلی با پروفایل جدا باز می‌شود و با اکانت خودتان کار می‌کند. یک بار خودتان وارد می‌شوید (کد ورود و رمز دومرحله‌ای را **فقط خودتان در همان پنجره** می‌زنید) و ورود ذخیره می‌ماند. 26 قابلیت از 26.

> English summary below.

## نصب در Claude Code / Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "eitaa": {
      "command": "npx",
      "args": ["-y", "@nabuxai/eitaa-mcp"],
      "env": {
        "NABU_MESSAGING_ENABLE_SEND": "1",
        "EITAA_BOT_TOKEN": "…",
        "EITAA_ALLOWED_CHAT_IDS": "…",
        "NABU_BROWSER_ENABLE": "1",
        "EITAA_WEB_ALLOWED_CHATS": "me"
      }
    }
  }
}
```

یا در Claude Code:

```bash
claude mcp add eitaa -e NABU_BROWSER_ENABLE=1 -e EITAA_WEB_ALLOWED_CHATS=me -- npx -y @nabuxai/eitaa-mcp
```

همه‌ی متغیرها در [`.env.example`](.env.example) توضیح داده شده‌اند. توکن بات: پنل eitaayar.ir. حالت وب به Chrome نصب‌شده نیاز دارد (یا `CHROME_EXECUTABLE_PATH`).

**IP ایران:** وب‌اپ و API بیشتر پیام‌رسان‌های ایرانی فقط از IP ایران جواب می‌دهند. اگر سیستم شما IP خارج دارد، از یک سرور داخل ایران تونل بزنید و `NABU_BROWSER_PROXY=socks5://127.0.0.1:1088` بدهید:

```bash
ssh -N -D 127.0.0.1:1088 <server-in-iran>
```

## شروع حالت وب

1. `eitaa_web_open` — پنجره باز می‌شود.
2. اگر وارد نیستید: `eitaa_web_login_start` با شماره موبایل؛ بعد کد را خودتان در پنجره بزنید.
3. `eitaa_web_list_chats`، `eitaa_web_read_chat`، `eitaa_web_send_message` و …

## قابلیت‌های حالت وب

| قابلیت | ابزار | |
|---|---|---|
| فهرست گفتگوها | `eitaa_web_list_chats` | ✅ |
| خواندن پیام‌ها | `eitaa_web_read_chat` | ✅ |
| ارسال متن (و پاسخ) | `eitaa_web_send_message` | ✅ |
| ارسال عکس و فایل | `eitaa_web_send_file` | ✅ |
| ویرایش پیام | `eitaa_web_editText` | ✅ |
| حذف پیام | `eitaa_web_deleteMessages` | ✅ |
| هدایت (فوروارد) | `eitaa_web_forwardMessages` | ✅ |
| سنجاق کردن | `eitaa_web_pinMessage` | ✅ |
| خوانده‌شده کردن | `eitaa_web_markRead` | ✅ |
| ارسال موقعیت | `eitaa_web_sendLocation` | ✅ |
| ارسال مخاطب | `eitaa_web_sendContact` | ✅ |
| ارسال نظرسنجی | `eitaa_web_sendPoll` | ✅ |
| اطلاعات گفتگو | `eitaa_web_getChatInfo` | ✅ |
| اعضا | `eitaa_web_getMembers` | ✅ |
| جستجوی پیام | `eitaa_web_searchMessages` | ✅ |
| دانلود رسانه | `eitaa_web_downloadMedia` | ✅ |
| پیام‌های نخوانده | `eitaa_web_getUnread` | ✅ |
| مخاطبان | `eitaa_web_getContacts` | ✅ |
| ساخت گروه/کانال | `eitaa_web_createChat` | ✅ |
| تغییر نام/توضیح | `eitaa_web_updateChat` | ✅ |
| لینک دعوت | `eitaa_web_getInviteLink` | ✅ |
| عضویت | `eitaa_web_joinChat` | ✅ |
| ترک گفتگو | `eitaa_web_leaveChat` | ✅ |
| افزودن عضو | `eitaa_web_addMembers` | ✅ |
| حذف عضو | `eitaa_web_removeMember` | ✅ |
| ادمین کردن | `eitaa_web_setAdmin` | ✅ |

**محدودیت‌ها:** Message search matches whole words only. Member lists need admin rights in channels. Downloads up to 20 MB. Contacts come from the account's Eitaa contact list (may be empty on web).

## قفل‌های امنیتی

| کار | چه لازم دارد |
|---|---|
| خواندن | توکن بات، یا پنجره‌ی واردشده و `NABU_BROWSER_ENABLE=1` |
| نوشتن در گفتگو (ارسال، ویرایش، حذف، سنجاق، فوروارد…) | `confirm: true`، گفتگو در `EITAA_ALLOWED_CHAT_IDS` (بات) یا `EITAA_WEB_ALLOWED_CHATS` (وب)، و `NABU_MESSAGING_ENABLE_SEND=1` |
| تغییر اکانت (ساخت/عضویت/ترک گفتگو، اعضا، ادمین) | همه‌ی موارد بالا و `NABU_WEB_ALLOW_ACCOUNT_CHANGES=1` |

ارسال انبوه وجود ندارد: هر بار یک گفتگو، و حداکثر ۵ عضو در هر بار افزودن.

**هشدار:** حالت وب اکانت شخصی شما را خودکار می‌کند و ممکن است خلاف قوانین ایتا باشد؛ استفاده‌ی نادرست می‌تواند به محدود شدن اکانت برسد. هر کس به پوشه‌ی پروفایل مرورگر (`~/.nabuxai/iranian-messaging-profiles/eitaa`) دسترسی داشته باشد به اکانت شما دسترسی دارد. جزئیات در [SECURITY.md](SECURITY.md).

---

## English

An MCP server for Eitaa. **Bot mode** — Bot side via the Eitaayar API (eitaayar.ir): posting text and files only, to a channel where `@sender` is an admin. Token from the (paid) Eitaayar panel. **Web mode** drives Eitaa Web in a local Chrome window with your own signed-in account (you type the sign-in code yourself in that window; the session is kept in a local profile). 26 of 26 web operations are available here; call `eitaa_web_capabilities` for the live list.

Install: `npx -y @nabuxai/eitaa-mcp` (see the JSON config above; every variable is documented in `.env.example`). Writes need `confirm: true`, an allowlisted chat and `NABU_MESSAGING_ENABLE_SEND=1`; account changes also need `NABU_WEB_ALLOW_ACCOUNT_CHANGES=1`. There is no bulk sending. Most Iranian messenger hosts only answer Iranian IPs; use `NABU_BROWSER_PROXY` with a SOCKS tunnel if needed.

Built on [`@nabuxai/iranian-messaging-core`](https://github.com/NabuxAi/iranian-messaging-core). Sister servers: [eitaa-mcp](https://github.com/NabuxAi/eitaa-mcp), [rubika-mcp](https://github.com/NabuxAi/rubika-mcp), [bale-mcp](https://github.com/NabuxAi/bale-mcp), [soroushplus-mcp](https://github.com/NabuxAi/soroushplus-mcp), [gap-mcp](https://github.com/NabuxAi/gap-mcp).

MIT © NabuxAI. Community project; not affiliated with or endorsed by Eitaa.
