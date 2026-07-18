# TODO - Railway + Database readiness

- [x] Update Railway deploy start/build commands to run Prisma migrations automatically.
- [ ] Ensure Prisma client generation works correctly in Railway build.

- [ ] Verify local dev db file is not included in repo/build (already ignored, confirm).
- [ ] Run `npm run build` locally (with DATABASE_URL pointing to a local postgres if available) and `prisma migrate deploy` to validate.

