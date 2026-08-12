# Emplement
A modernized, 508-compliant rebuild of Emplement, starting with Phase 1: the unemployment-claims core (Missouri UInteract replacement).

## Local development database

This project expects a **native local PostgreSQL 16 instance** (not Docker) — see `.env.example` for the default connection string.

Setup:
1. `cp .env.example .env`, then set real values for `NEXTAUTH_SECRET` (`openssl rand -base64 32`) and `SSN_ENCRYPTION_KEY` (`openssl rand -hex 32`).
2. Create the app role/database if they don't exist yet:
   ```sql
   CREATE USER emplement WITH PASSWORD 'emplement';
   CREATE DATABASE emplement_claims OWNER emplement;
   GRANT ALL PRIVILEGES ON DATABASE emplement_claims TO emplement;
   ```
3. Grant `CREATEDB` to the `emplement` role — Prisma's `migrate dev` needs it to create/drop a temporary shadow database when diffing migrations, and without it `migrate dev` fails with `P3014: permission denied to create database`:
   ```sql
   ALTER USER emplement CREATEDB;
   ```
4. `npx prisma migrate dev` to apply migrations.
