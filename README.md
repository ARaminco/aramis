# Aramis

یک ایجنت هوش مصنوعی وب‌محور برای مدیریت سرور و سیستم — جایگزین CLI با یک چت حرفه‌ای DevOps. روی هر سیستم‌عاملی (Linux / macOS / Windows) کار می‌کنه و از همه‌ی AI providerهای مهم پشتیبانی می‌کنه (OpenAI, Anthropic, Groq, OpenRouter, Together, Ollama لوکال).

> Web-based AI agent for sysadmin/DevOps work. Chat in any language; Aramis plans → investigates → executes → verifies, just like a senior engineer at a terminal.

---

## امکانات / Features

### چت ایجنتی (Agentic chat)
- **Plan → Investigate → Execute → Verify** — قبل از هر کار یه پلن می‌ده، مرحله‌مرحله اجرا می‌کنه، و در پایان verify می‌کنه. **هیچ‌وقت** قبل از دیدن نتیجه‌ی واقعی tool جواب نمی‌ده.
- **Streaming زنده** — متن مدل، tool calls، stdout/stderr دستورات همه به‌صورت live در UI میان.
- **Tool calls شفاف** — هر دستور با اسم/پارامترها/exit code/خروجی در یک کارت قابل‌بازکردن نمایش داده می‌شه (سبک ترمینال واقعی).
- **پرسش پارامتر** (`ask_user`) — اگر مدل وسط کار به ورودی نیاز داشت، loop متوقف می‌شه و UI input نشون می‌ده.
- **چند چت همزمان** + هیستوری + ادامه‌ی کار قبلی با کل context.

### ورودی صوتی
- **یک دکمه‌ی میکروفون** کنار composer — کلیک می‌کنی، صحبت می‌کنی، دوباره کلیک می‌کنی، متن transcribe شده در input ظاهر می‌شه.
- **هر زبانی** — از Whisper استفاده می‌کنه که به‌صورت خودکار از بین ۹۹+ زبان تشخیص می‌ده.
- از OpenAI Whisper (`whisper-1`) یا Groq Whisper (`whisper-large-v3-turbo` — رایگان) استفاده می‌کنه.

### حالت تأیید دستورات (Auto / Manual)
- **Auto**: همه‌ی دستورات بدون پرسش اجرا می‌شن (پیش‌فرض).
- **Manual**: قبل از هر `run_command` / `read_file` / `write_file` / `list_dir`، یه دکمه‌ی Approve/Deny روی کارت ابزار ظاهر می‌شه.

### حافظه‌ی بلندمدت (Long-term memory)
- ایجنت می‌تونه ترجیحات و factهای ثابت رو در DB ذخیره کنه (`remember(key, value, kind)`)، در چت‌های بعدی هم به یاد می‌مونن.
- نوع‌بندی: `preference` / `fact` / `env` / `secret` / `note`.
- لیست/حذف از Settings → حافظه‌ی بلندمدت.

### تست‌های سلامت داخلی (Diagnostics)
- ۹ تست در Settings → «اجرای تست‌ها»: سرور، DB read/write، تشخیص سیستم، File I/O، shell، حافظه، AI config، و **یه ping واقعی** به AI provider (با latency و خطای دقیق).

### چندارائه‌دهنده (Multi-provider)
- OpenAI / Anthropic / Groq / OpenRouter / Together / Ollama لوکال / هر OpenAI-compatible
- timeout قابل تنظیم (10–600 ثانیه)
- خطاهای شبکه با پیام‌های واضح: ECONNREFUSED، 401، 403، 404، 429، timeout — هر کدوم با راهنمای راه‌حل
- log کامل خطاها در server console

### UI/UX
- **ریسپانسیو ۱۰۰٪** — drawer sidebar روی موبایل، sticky composer با safe-area iPhone، dynamic viewport (`100dvh`).
- **دو زبانه** — فارسی + انگلیسی، swap خودکار `<html dir>` و `<html lang>`.
- **Dark/Light mode** + **UI scale** (80%–150% بزرگ‌نمایی متن، شامل همه‌چیز).
- **Markdown rendering** در پیام‌ها (هد، لیست، code blocks با syntax highlighting).
- **shadcn-style** UI با [reka-ui](https://reka-ui.com/) و Tailwind.

### Data
- SQLite لوکال (`server/data/aramis.db`) با better-sqlite3 + WAL.
- جدول‌ها: `settings`, `chats`, `messages`, `memory`.
- **Export کامل DB** و **wipe data** از Settings.

---

## معماری

```
┌─────────────────────────────────────────────────────────────┐
│                         web (Vue 3 + Vite)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Setup   │  │  Login   │  │   Chat   │  │ Settings │    │
│  └──────────┘  └──────────┘  └────┬─────┘  └──────────┘    │
│                  Pinia stores ◀───┘   shadcn/Tailwind UI   │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP + SSE + multipart (voice)
┌────────────────────────▼────────────────────────────────────┐
│                    server (Express)                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Routes:  /auth  /config  /system  /chats          │   │
│  │           /data  /diagnostics  /transcribe         │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Services:                                          │   │
│  │   • agent.js     — Plan → Execute loop, ask_user,  │   │
│  │                    manual approval, memory inject   │   │
│  │   • ai-provider  — OpenAI/Anthropic/+ unified       │   │
│  │   • tools.js     — run_command / read / write /     │   │
│  │                    list_dir / ask_user / remember   │   │
│  │   • system-info  — OS / shell / pkg-mgr detection   │   │
│  │   • diagnostics  — 9-check health probe             │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  SQLite (better-sqlite3, WAL)                       │   │
│  │   settings · chats · messages · memory              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                         │ HTTPS streaming
                         ▼
                  AI Provider (OpenAI / Groq / ...)
```

---

## نیازمندی‌ها / Requirements

- **Node.js ≥ 20** (تست‌شده روی v22)
- **npm ≥ 9**
- یکی از این provider ها:
  - **OpenAI** (`gpt-4.1-mini`, `gpt-4o`, …) — کلید از platform.openai.com
  - **Groq** — رایگان و خیلی سریع، روی ایران معمولاً باز — console.groq.com
  - **OpenRouter** — proxy واحد برای همه — openrouter.ai
  - **Anthropic** (Claude family) — console.anthropic.com
  - **Ollama** لوکال — هیچ کلیدی لازم نداره، بدون اینترنت

---

## اجرای سریع (Development)

```bash
# نصب همه‌ی dependencies (root + server + web)
npm run install:all

# اجرای dev mode — server روی 5174، Vite روی 5173 با proxy
npm run dev
```

سپس مرورگر رو روی http://localhost:5173 باز کنید:
1. اولین بازدید → **Setup**: یک رمز عبور تعیین کنید
2. خودکار به **Settings** هدایت می‌شید → provider و model و API key رو وارد کنید
3. **اجرای تست‌ها** رو بزنید تا مطمئن بشید همه‌چیز سالمه
4. به **Chat** برید و شروع کنید

---

## ساخت نسخه‌ی production (Build)

```bash
# ۱) نصب
npm run install:all

# ۲) build فرانت‌اند (خروجی در web/dist/)
npm run build

# ۳) اجرای production server (روی پورت 5174 — همون پورت SPA رو هم serve می‌کنه)
npm --prefix server start
# یا با env سفارشی:
PORT=8080 JWT_SECRET="$(openssl rand -hex 32)" npm --prefix server start
```

در production، `server/src/index.js` خودش `web/dist/` رو به‌عنوان static serve می‌کنه — همه‌چیز روی یک پورت. حالا فقط http://localhost:5174 رو باز کنید.

### اجرا با pm2 (recommended for VPS)

```bash
npm i -g pm2
cd /path/to/aramis
npm run install:all && npm run build
pm2 start server/src/index.js --name aramis --env production
pm2 save && pm2 startup
```

### اجرا با systemd

`/etc/systemd/system/aramis.service`:
```ini
[Unit]
Description=Aramis
After=network.target

[Service]
Type=simple
User=aramis
WorkingDirectory=/opt/aramis
Environment="PORT=5174"
Environment="JWT_SECRET=put-a-long-random-string-here"
ExecStart=/usr/bin/node server/src/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now aramis
```

---

## متغیرهای محیطی

| نام | پیش‌فرض | شرح |
|---|---|---|
| `PORT` | `5174` | پورت Express |
| `JWT_SECRET` | dev secret | **در production حتماً تغییر بدید** |
| `DB_PATH` | `server/data/aramis.db` | مسیر فایل SQLite |

---

## ساختار پروژه

```
aramis/
├── package.json              # root scripts (install:all, dev, build, start)
├── README.md
├── server/
│   ├── package.json          # express, better-sqlite3, openai, anthropic, multer, ...
│   └── src/
│       ├── index.js          # Express entry + static SPA serving
│       ├── db.js             # SQLite schema + helpers (settings/chats/messages/memory)
│       ├── middleware/auth.js
│       ├── routes/
│       │   ├── auth.js       # setup/login/change-password
│       │   ├── config.js     # AI config CRUD
│       │   ├── system.js     # OS detection
│       │   ├── chats.js      # CRUD + SSE /stream + approval/ask flow
│       │   ├── data.js       # stats / export / wipe / memory CRUD
│       │   ├── diagnostics.js
│       │   └── transcribe.js # Whisper voice → text
│       └── services/
│           ├── agent.js
│           ├── ai-provider.js
│           ├── tools.js
│           ├── system-info.js
│           └── diagnostics.js
└── web/
    ├── package.json          # vue, vite, tailwind, reka-ui, lucide, marked, ...
    └── src/
        ├── main.js
        ├── App.vue
        ├── router.js
        ├── style.css         # Tailwind + RTL + Vazirmatn
        ├── lib/
        │   ├── api.js        # fetch wrapper + SSE
        │   ├── i18n.js       # fa + en
        │   ├── voice.js      # MediaRecorder + transcription
        │   ├── ui-scale.js   # font-size scaling
        │   └── utils.js
        ├── stores/
        │   ├── auth.js
        │   └── chat.js
        ├── components/
        │   ├── ui/           # Button, Input, Card, Dialog, ...
        │   ├── MessageContent.vue
        │   └── ToolCallCard.vue
        └── views/
            ├── Setup.vue
            ├── Login.vue
            ├── Settings.vue
            └── Chat.vue
```

---

## امنیت / Security

- رمز عبور با **bcrypt** (12 round) hash می‌شه و در SQLite ذخیره می‌شه — هرگز در plain.
- درخواست‌های API با **JWT** (HS256، expire 7d) احراز می‌شن.
- API keys مدل‌ها در DB ذخیره می‌شن و در پاسخ‌های `GET /api/config/ai` به‌صورت `••••XXXX` redact می‌شن.
- **`JWT_SECRET` رو در production عوض کنید** (یه رشته‌ی تصادفی 64+ کاراکتری).
- Aramis روی همین میزبان دستور shell اجرا می‌کنه — پشت یک reverse proxy (nginx/Caddy) و فقط با HTTPS deploy کنید. حالت Manual approval رو روشن کنید اگر کلیدها در دست افراد متعدد هست.

---

## ساخته‌شده توسط

**[Aliasghar Ramin](https://aramin.co)** — Full-stack developer
🌐 [aramin.co](https://aramin.co)

اگر این پروژه براتون مفید بود، یه ⭐ بزنید یا در سایت بالا با من تماس بگیرید.

## License

MIT © 2026 Aliasghar Ramin
