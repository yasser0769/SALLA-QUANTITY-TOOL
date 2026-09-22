# WhatsApp Abandoned Cart (Salla + Baileys)

أداة غير رسمية ترسل رسائل واتساب تلقائية لعملاء السلات المتروكة في سلة.

> ⚠️ Baileys يخالف شروط استخدام واتساب. استخدم **رقماً مخصصاً** غير رقم متجرك الأساسي.
> الرقم معرّض للحظر، وفقدانه يجب ألا يعطّل متجرك.

## المتطلبات

- Node.js 20+
- خادم **دائم** (VPS / Railway / Render / Fly) — لا يعمل على Vercel أو أي serverless،
  لأن Baileys يحتاج اتصالاً مفتوحاً وجلسة محفوظة على القرص.
- دومين HTTPS للـ webhook (سلة ترفض HTTP).

## التشغيل

```bash
cd WHATSAPP-CART
npm install
cp .env.example .env   # املأ SALLA_WEBHOOK_SECRET و ADMIN_TOKEN
node server.js
```

أول تشغيل يطبع باركود في الطرفية → واتساب > الأجهزة المرتبطة > ربط جهاز.
الجلسة تُحفظ في `data/auth/`، فما يتكرر الطلب بعد كل إعادة تشغيل.

**قبل ما تربط رقمك الحقيقي:** شغّل بـ `DRY_RUN=1` — يطبع الرسائل بدل ما يرسلها.

## الربط مع سلة

من لوحة سلة > أحداث Webhook > حدث جديد، أنشئ حدثين على نفس الرابط:

| نوع الحدث | الفائدة |
|---|---|
| `انشاء سلة مشتريات متروكة` | يجدول رسائل المتابعة |
| `انشاء طلب` | يلغي المتابعة لمن أكمل الشراء |

- **رابط الحدث:** `https://your-domain.com/webhooks/salla`
- **إصدار Webhook:** v2
- انسخ الـ Webhook Secret من بوابة الشركاء إلى `SALLA_WEBHOOK_SECRET`.
  بدونه كل الطلبات تُرفض بـ 401 — وهذا مقصود، لأن الرابط مكشوف للإنترنت.

## المسارات

| المسار | الوصف |
|---|---|
| `POST /webhooks/salla` | مستقبل أحداث سلة (يتحقق من توقيع HMAC) |
| `GET /health` | فحص حياة الخدمة |
| `GET /qr?token=...` | حالة اتصال واتساب |
| `GET /admin/stats?token=...` | عدّادات الإرسال والحالة |
| `POST /admin/block?phone=966...&token=...` | إيقاف رقم يدوياً |

## الرسائل

عدّل `config.js`: كل مرحلة فيها `delayMinutes` ونص الرسالة.
الافتراضي رسالتان — بعد 45 دقيقة، ثم بعد 24 ساعة.

## الحمايات المدمجة

- **سقف يومي** (`DAILY_LIMIT`) على آخر 24 ساعة — فرملة أمان ضد أي خلل يسبب انفجار إرسال.
- **ساعات هدوء** (`QUIET_HOURS_*`) — لا إرسال ليلاً؛ الرسائل تنتظر الصباح.
- **فاصل عشوائي** 10-30 ثانية بين كل رسالة بدل الدفعات السريعة.
- **إيقاف تلقائي**: من يرد بـ «إلغاء» يُضاف لقائمة الحظر ولا يصله شيء بعدها.
- **إلغاء عند الشراء**: حدث `order.created` يلغي الرسائل المعلّقة لنفس الرقم.
- **تحقق من الرقم** عبر `onWhatsApp` قبل الإرسال — الأرقام غير المسجلة تُتخطى.
- **منع التكرار**: `UNIQUE(cart_id, stage)` يمنع جدولة نفس الرسالة مرتين لو أعادت سلة إرسال الحدث.

## البيانات

`data/carts.db` (SQLite) — السلات، جدول الرسائل، قائمة الحظر.
`data/auth/` — جلسة واتساب. **احتفظ بنسخة احتياطية منه**، وضعه على قرص دائم لو استضفت على Railway/Fly.

## تشغيل دائم على VPS

```bash
sudo tee /etc/systemd/system/whatsapp-cart.service > /dev/null <<'EOF'
[Unit]
Description=WhatsApp Abandoned Cart
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/path/to/WHATSAPP-CART
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now whatsapp-cart
journalctl -u whatsapp-cart -f   # لمشاهدة الباركود أول مرة
```

ضع nginx أمامه لشهادة HTTPS، ووجّه `/webhooks/salla` للمنفذ 3100.
