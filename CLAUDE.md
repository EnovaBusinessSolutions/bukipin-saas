# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bukipin is a SaaS financial management platform (Business Intelligence & FP&A) for Mexican SMEs. It handles accounting, invoicing, inventory, CXC/CXP, and financial reporting.

## Repository Structure

This is a monorepo with two git submodules:

```
bukipin-saas/
├── backend/          # Express.js API (CommonJS, Node.js)
├── bukipin-dashboard/  # React SPA for the main app (git submodule)
├── bukipin-login-seamless/  # React SPA for landing/auth (git submodule)
├── public/           # Static build output served by Express
│   ├── login/        # Built output of bukipin-login-seamless
│   └── dashboard/    # Built output of bukipin-dashboard
└── package.json      # Root: runs backend + build orchestration
```

## Commands

### Backend
```bash
npm run dev          # Start backend (node backend/server.js), port 3000
```

### Full Build (production)
```bash
npm run bootstrap    # Init submodules + install deps in each submodule
npm run build        # bootstrap + build both SPAs to public/
npm run build:login      # Build login SPA → public/login/
npm run build:dashboard  # Build dashboard SPA → public/dashboard/
```

### Frontend Dev (run inside submodule directory)
```bash
cd bukipin-dashboard && npm run dev    # Dashboard dev server, port 8080
cd bukipin-login-seamless && npm run dev  # Login dev server, port 8080
cd bukipin-dashboard && npm run lint
cd bukipin-login-seamless && npm run lint
```

## Architecture

### Request Flow
1. Express serves static files from `public/`
2. Routes `/` and `/login*` → `public/login/index.html` (login SPA)
3. Routes `/dashboard*` → `public/dashboard/index.html` (dashboard SPA)
4. Routes `/api/*` → Express API handlers
5. All API responses that are not matched return 404 JSON

### Authentication
- JWT stored in **httpOnly cookie** named `bukipin_token` (7-day expiry)
- `backend/middleware/ensureAuth.js` validates the cookie on every protected route
- `req.user` is set to `{ _id, name, email, isVerified }` after auth
- Email verification is required before login; verification token sent via SMTP
- After email verification, `seedDefaultsForUser()` seeds default chart of accounts

### Multi-Tenant Data Model
Every MongoDB document has an `owner` field (User `_id`). All queries MUST filter by `owner` to enforce tenant isolation.

### Backend Structure
```
backend/
├── server.js          # Entry point, mounts all routes
├── config/db.js       # MongoDB connection (MONGO_URI env var required)
├── middleware/
│   └── ensureAuth.js  # JWT auth middleware
├── models/            # Mongoose schemas (User, Account, IncomeTransaction, etc.)
├── routes/            # One file per domain area
├── controllers/
│   └── flujoEfectivoController.js
├── services/          # Business logic (inventory cost engine, CXC service, etc.)
└── utils/
    ├── seedDefaults.js  # Seeds default chart of accounts per user
    ├── sendEmail.js     # Nodemailer via SMTP
    └── datetime.js
```

### Dashboard SPA (bukipin-dashboard)
- Built with: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix UI), React Router v6 (basename `/dashboard`), TanStack Query v5
- All API calls use **`apiFetch()`** from `src/lib/api.ts` — this function always includes `credentials: "include"` to send the session cookie
- Data-fetching logic lives in custom hooks under `src/hooks/use*.tsx`
- Components are organized by domain under `src/components/<Domain>/`
- **Important**: `src/integrations/supabase/client.ts` is a throw-proxy — the app was migrated from Supabase to the Express backend. Any attempt to call `supabase.*` will throw a migration error. Always use `apiFetch()` instead.

### Login SPA (bukipin-login-seamless)
- Same stack (React, Vite, TypeScript, Tailwind, shadcn/ui)
- Handles: landing `/`, login/register `/login`, post-register confirmation, password recovery
- Routes: `BrowserRouter` without a basename (serves from root)

## Environment Variables

Required in `.env` at repo root:

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `CLIENT_URL` | Base URL (e.g. `https://bukipin.com`) for email links |
| `PORT` | Server port (default 3000) |
| `NODE_ENV` | `development` or `production` |
| `SMTP_HOST/PORT/USER/PASS` | Email delivery credentials |
| `SMTP_FROM_NAME/EMAIL` | Sender identity for transactional emails |
| `APP_TZ_OFFSET_MINUTES` | Timezone offset for date calculations (e.g. `-360` for CST) |

## API Routes Reference

All routes are prefixed with `/api/`:

| Prefix | Domain |
|---|---|
| `/auth` | Register, login, logout, me, verify-email, forgot/reset-password |
| `/cuentas`, `/subcuentas` | Chart of accounts |
| `/ingresos`, `/egresos`, `/transacciones` | Income/expense transactions |
| `/clientes`, `/proveedores` | Clients and suppliers |
| `/productos`, `/inventario`, `/movimientos-inventario` | Inventory |
| `/financiamientos`, `/inversiones`, `/capital`, `/accionistas` | Financing & equity |
| `/cxc`, `/cxp`, `/cobros-pagos` | Accounts receivable/payable |
| `/impuestos`, `/asientos`, `/contabilidad` | Tax and accounting entries |
| `/flujo-efectivo`, `/dashboard` | Reports |
| `/deudores-financieros`, `/instituciones-financieras` | Financial debtors |

## Key Conventions

- **Backend is CommonJS** (`require`/`module.exports`), not ESM
- **Frontend is ESM** with TypeScript; path alias `@/` maps to `src/`
- Vite build output: login → `../public/login`, dashboard → `../public/dashboard` (relative to each submodule)
- API responses follow the shape `{ ok: boolean, data?: any, message?: string }`
- The `Account` type field accepts: `activo | pasivo | capital | ingreso | gasto | orden`
