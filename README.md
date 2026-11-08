# Personal Finance Manager

Allocate first. Spend second. A personal finance platform that always shows what you have, what is already committed, and what you can actually spend.

- Plan: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)
- Status: [docs/PROGRESS.md](docs/PROGRESS.md)

## Backend

Requires Node.js 20+.

```bash
cd backend
npm install
cp .env.example .env     # then set JWT_ACCESS_SECRET
npm test                 # 35 tests on embedded Postgres (PGlite)
npm run dev              # http://localhost:4000/api/v1, docs at /api/docs
```

With `DATABASE_URL` empty, the API uses embedded PGlite stored in `PGLITE_DATA_DIR`. This is for development only. For a real Postgres:

```bash
docker compose up -d     # Postgres 16 + Redis 7
DATABASE_URL=postgres://pfm:pfm@localhost:5432/pfm npm run migrate
```

Production refuses to start without `DATABASE_URL` and a JWT secret of at least 32 characters.

## Money rules (summary)

- Amounts are `NUMERIC(19,2)` and travel as strings (`"8000.00"`). Floating point is never used.
- Balances = opening balance + append-only ledger entries. Only confirmed transactions count.
- Transfers between your own accounts are never income or expenses. A credit card bill payment is a transfer.
- Reservations are plans inside the app. They lower available-to-spend but never block money at the bank.
