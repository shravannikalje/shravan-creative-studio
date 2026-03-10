# Website Handover Guide (Marathi)

ही guide friend ला द्यायची आहे, म्हणजे त्याला website कशी चालते ते लगेच समजेल.

---

## 1) Project मध्ये महत्त्वाचे files कोणते?

### `index.html`
- Main website page.
- यात सर्व sections आहेत (Hero, Services, Pricing, Contact, etc.).
- `Custom` section placeholder इथे आहे, पण content `custom-content.html` मधून येतो.

### `style.css`
- पूर्ण website styling.
- Color, layout, responsive, custom section styles इथे आहेत.

### `script.js`
- Frontend logic:
  - WhatsApp button actions
  - Contact form data submit
  - Live status UI
  - Custom section show/hide logic
  - Custom content auto-refresh

### `node.js`
- Backend server (Express).
- काम:
  - Login session handling
  - Google OAuth auth endpoint
  - Leads save/read APIs
  - Admin access guard
  - Custom section access rules (phone + trusted device)

### `login.html`
- Google sign-in page.
- फक्त allowed Gmail ने login झाल्यावर main website open होते.

### `admin.html`
- Admin dashboard.
- `/admin` वर open होते.
- Leads, stats, search इथे मिळतात.

### `custom-content.html`
- Custom section मध्ये दिसणारा editable content.
- `<body>` मधला content website वर render होतो.
- फक्त authorized trusted phone वर दिसतो.

### `data/leads.json`
- Contact/estimate/package leads इथे save होतात.

### `data/custom-devices.json`
- Trusted device pairing map (email -> device token) इथे save होतो.
- Custom section “एका फोनवरच” lock करण्यासाठी वापरला जातो.

### `.env`
- सर्व sensitive/config values:
  - Google Client ID
  - Allowed emails
  - Admin emails
  - Custom section security toggles

---

## 2) Login आणि access flow कसा चालतो?

1. User website open करतो.
2. login नसल्यास `/login` page दिसते.
3. Google login successful झाला की server session बनवतो.
4. फक्त `ALLOWED_EMAILS` मधले Gmail IDs आत जाऊ शकतात.
5. `ADMIN_EMAILS` मधले users `/admin` उघडू शकतात.

---

## 3) Custom section security (important)

Custom section access साठी 3 checks आहेत:

1. Gmail `CUSTOM_SECTION_EMAILS` मध्ये असणे.
2. Device mobile असणे (`CUSTOM_SECTION_PHONE_ONLY=true`).
3. Trusted device token match (`CUSTOM_SECTION_REQUIRE_TRUSTED_DEVICE=true`).

### पहिल्यांदा काय होते?
- Allowed mobile device वर first time custom access झाला की तो device token `data/custom-devices.json` मध्ये save होतो.
- पुढे फक्त तोच paired phone custom section पाहू शकतो.

### Wrong phone pair झाला तर?
- `data/custom-devices.json` मधील त्या email ची entry delete करा.
- पुन्हा योग्य phone वरून open करा → नवीन pairing होईल.

---

## 4) Friend ने website run कशी करायची?

### Prerequisites
- Node.js installed
- Google OAuth Client ID configured

### Setup
1. project folder open करा.
2. dependencies install करा (`npm install`).
3. `.env` file मध्ये correct values भरा.
4. server start करा (`npm start`).
5. browser मध्ये `http://localhost:3000` उघडा.

---

## 5) `.env` मध्ये काय टाकायचं?

Minimum required:

- `GOOGLE_CLIENT_ID`
- `SESSION_SECRET`
- `ALLOWED_EMAILS`
- `ADMIN_EMAILS`
- `CUSTOM_SECTION_EMAILS`
- `CUSTOM_SECTION_PHONE_ONLY=true`
- `CUSTOM_SECTION_REQUIRE_TRUSTED_DEVICE=true`

> जर custom section सगळ्या allowed phones वर चालू करायचा असेल तर `CUSTOM_SECTION_REQUIRE_TRUSTED_DEVICE=false` करा.

---

## 6) Daily use (owner/friend)

### Content बदलायचा असेल
- `custom-content.html` edit करा (body मधला block बदला).
- save केल्यावर custom section auto-refresh होते (किंवा manual refresh).

### Leads बघायचे असतील
- admin email ने login करा.
- `/admin` उघडा.

### Security बदलायची असेल
- `.env` मधले custom settings बदला.
- server restart करा.

---

## 7) Quick troubleshooting

### Login होत नाही
- `GOOGLE_CLIENT_ID` योग्य आहे का check करा.
- Gmail `ALLOWED_EMAILS` मध्ये आहे का check करा.

### Admin page उघडत नाही
- Gmail `ADMIN_EMAILS` मध्ये आहे का check करा.

### Custom section दिसत नाही
- login तोच Gmail आहे का?
- mobile वर उघडलंय का?
- wrong device pair झाला आहे का (`data/custom-devices.json` check)?

---

## 8) Handover checklist (friend ला देताना)

- [ ] `.env` values set केल्या
- [ ] login tested
- [ ] admin tested
- [ ] custom section trusted-phone वर tested
- [ ] wrong-phone block tested
- [ ] `data/` folder write permission tested

---

जर अजून simpler version हवी असेल तर या guide ची “2 page short version” बनवू शकतो.
