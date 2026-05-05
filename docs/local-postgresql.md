# Local PostgreSQL

Redirect Mapper Lite uses PostgreSQL for Shopify sessions, cleanup history, redirect records and contact requests.

## Local Homebrew defaults

- Host: `127.0.0.1`
- Port: `5432`
- Database: `redirect_mapper_lite`
- Development user: `qorve_dev`
- Password: store it only in `.env`; do not commit it

The Docker Compose hostname `postgres` only works from inside Docker. When running `shopify app dev` directly on macOS, use `127.0.0.1`.

## Required environment

```env
DATABASE_URL=postgresql://qorve_dev:<local-password>@127.0.0.1:5432/redirect_mapper_lite?schema=public
```

## Commands

```sh
brew services start postgresql@18
npm run setup
npm run dev
```

## Production notes

Use a managed PostgreSQL instance, a generated password, SSL if required by the provider, backups, and connection pooling/limits appropriate for the runtime. Keep `DATABASE_URL` in the platform secret manager, not in Git.
