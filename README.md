# Careclinics HQ Services — Unified Vercel Project

All 5 HQ services previously split across `docker-compose.yml` have been unified into a single, zero-config **Vercel-ready web project** (`careclinics-hq-services`) with separated **Regular Staff Viewing Access** and **Password-Protected Administrator Access**.

## Access Levels & Credentials

### 1. Regular Staff Viewing Access (`/`)
Normal staff visiting the main portal (`/`) can access:
- **Submit Department Update** (`/meeting/input.html`) — Submit weekly/monthly updates & Q&A questions with live slide preview.
- **Book HQ Meeting Room** (`/booking/`) — Reserve rooms and view room availability & schedules (editing/deleting existing bookings is restricted to Administrators).
- **Open BentoPDF Studio** (`/pdf/`) — 100% browser-based private PDF toolkit (12 tools).
- **Live Status Widgets on `/`** — *Weekly Meeting Alignment Readiness* & *HQ Meeting Rooms & Today's Schedule*.

### 2. Administrator Access (`/login.html` → `/admin/`)
Administrators log in at `/login.html` to unlock `/admin/` and full privileges across all modules:
- **Default Admin Username**: `admin` (or `process.env.ADMIN_USERNAME` on Vercel)
- **Default Admin Password**: `cchs2026` (or `process.env.ADMIN_PASSWORD` on Vercel; can also be updated inside `/admin/`)
- **Admin Privileges**:
  - Access **all Staff & Admin features** from the **Admin Command Portal** (`/admin/`).
  - **Update / Edit & Delete Existing and Upcoming Room Bookings** (both inside `/admin/` and on `/booking/`).
  - **Alignment Admin Console** (`/meeting/admin.html`) — Control slide visibility, reorder/rename departments, edit C-Suite closing remarks, and reset meeting sessions.
  - **Meeting TV Presentation Deck** (`/meeting/`) — Full 1920×1080 Weekly Alignment TV Slide Deck & Forza Q&A Reel.
  - **Remote Display Controller** (`/display/`) — Control HQ Lobby TVs, Boardroom 75" Display, and Room Door Tablets.

## Running Locally

```bash
npm start
```
Then open `http://localhost:3000`.

## Deploying to Vercel

Run `npx vercel --prod` or push to your connected GitHub repository (`PandaMerah/CCHS-HQ-SERVICES`).
