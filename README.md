# Shravan Creative Studio

Shravan Creative Studio portfolio website with password login, admin panel, custom mobile-only section, lead tracking, and visitor analytics.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/shravannikalje/shravan-creative-studio)

Direct deploy link: `https://dashboard.render.com/blueprint/new?repo=https://github.com/shravannikalje/shravan-creative-studio`

## Repo details

- **Repository name:** `shravan-creative-studio`
- **Suggested live URL:** `https://shravan-creative-studio.onrender.com`
- **Admin URL:** `https://shravan-creative-studio.onrender.com/admin`
- **Local URL:** `http://10.150.230.156:8080`

> Note: The Render URL above is the preferred service URL if that name is available during deployment.

## Features

- Password-based website login
- Admin panel for leads and visitor stats
- Custom mobile-only section
- Trusted device lock for custom section access
- Lead capture and lead analytics
- WhatsApp inbound query sync to admin panel (via webhook)
- Visitor tracking and daily stats
- Static frontend with Express backend

## Tech stack

- Node.js
- Express.js
- Vanilla HTML, CSS, JavaScript
- JSON file storage

## Project structure

```text
shravan-creative-studio/
├── .env.example
├── .gitignore
├── README.md
├── FRIEND-HANDOVER.md
├── render.yaml
├── package.json
├── package-lock.json
├── node.js
├── index.html
├── login.html
├── admin.html
├── custom-content.html
├── script.js
├── style.css
└── data/
    ├── .gitkeep              # keeps the folder structure in GitHub
    ├── leads.json            # local/runtime, not pushed to GitHub
    ├── custom-devices.json   # local/runtime, not pushed to GitHub
    └── visitors.json         # local/runtime, not pushed to GitHub
```

## File purpose

- `node.js` - Express server, auth, sessions, APIs, leads, visitor tracking
- `index.html` - Main portfolio website
- `login.html` - Password login page
- `admin.html` - Admin dashboard for leads and visitors
- `custom-content.html` - Editable custom content section
- `script.js` - Frontend logic, custom access checks, live behavior
- `style.css` - Main website styling
- `render.yaml` - Render deployment configuration
- `.env.example` - Environment variable template
- `.gitignore` - Ignore secrets, dependencies, and local runtime data
- `FRIEND-HANDOVER.md` - Project handover notes
- `data/.gitkeep` - Keeps the `data/` folder visible in the repository
- `data/*.json` - Runtime data files for leads, device locks, and visitors

## Important routes

- `/` - Main website
- `/login` - Login page
- `/admin` - Admin panel
- `/api/leads` - Leads API
- `/api/queries` - Query inbox API (WhatsApp + website queries)
- `/api/leads/stats` - Lead statistics
- `/api/visitors/stats` - Visitor statistics
- `/api/custom-access` - Custom section access check
- `/api/whatsapp/webhook` - WhatsApp webhook (GET verify, POST incoming messages)

## Environment variables

Use `.env.example` as a reference.

Required values for deployment:

- `AUTH_MODE=password`
- `ACCESS_PASSWORD=<your password>`
- `ADMIN_PASSWORD=<your admin password>`
- `SESSION_SECRET=<strong random secret>`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN=<random webhook verify token>`
- `CUSTOM_SECTION_PHONE_ONLY=true`
- `CUSTOM_SECTION_REQUIRE_TRUSTED_DEVICE=true`

## WhatsApp webhook setup (for inbound queries)

1. Set `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in `.env` (and in Render env vars for production).
2. In Meta WhatsApp Cloud API webhook settings, use callback URL:
   - `https://<your-domain>/api/whatsapp/webhook`
3. Enter the same verify token value there.
4. Subscribe to `messages` webhook field.

Once configured, incoming WhatsApp messages are stored as leads with source `whatsapp-inbound` and shown in `/admin`.

## Deployment

### GitHub

Push all source files except secrets and local runtime data.

### Render

This project includes `render.yaml` for deployment.

- Build command: `npm install`
- Start command: `npm start`

## Notes

- Do not push `.env` to GitHub.
- `data/` files are local/runtime files and may reset on some hosting plans.
- For permanent data storage, move leads and visitors to a database later.
