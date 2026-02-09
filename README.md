# TaskEarn – Server (Express + MongoDB)

Back-end API for the Micro-Task and Earning Platform. Express 5, MongoDB, JWT, optional Stripe.

## Setup

```bash
cp .env.example .env
# Set DB_USER, DB_PASS, JWT_SECRET, optional STRIPE_SECRET_KEY
npm install
npm run dev
```

Runs at `http://localhost:5000` by default.

## Env (.env)

- `PORT` – server port (default 5000)
- `DB_USER` – MongoDB username
- `DB_PASS` – MongoDB password
- `JWT_SECRET` – secret for JWT signing
- `STRIPE_SECRET_KEY` – optional; if missing, dummy payment is used for purchase-coin

## Collections (microTaskDB)

- `users` – email, name, photo, role, coins, createdAt
- `tasks` – task fields, buyer_email, buyer_name, required_workers, payable_amount, etc.
- `submissions` – task_id, worker_email, worker_name, buyer_email, status, submission_details, etc.
- `payments` – buyer_email, coins, amount, transactionId, date
- `withdrawals` – worker_email, withdrawal_coin, withdrawal_amount, payment_system, status, etc.
- `notifications` – message, toEmail, actionRoute, time

## Scripts

- `npm run dev` – nodemon
- `npm start` – node index.js
