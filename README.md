# Watch Party

A Next.js watch party app with rooms, chat, video sync, Socket.IO, and Prisma.

## Local Setup

Install dependencies:

```bash
npm install
```

Create a `.env` file:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/watchparty"
PORT=3000
```

Run database migrations:

```bash
npm run db:migrate
```

Start the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Deploy on Railway

### 1. Push the project to GitHub

Make sure the latest code is pushed to your repository:

```bash
git add .
git commit -m "Update app"
git push
```

Do not commit `.env`. It is ignored by `.gitignore`.

### 2. Create a Railway project

1. Open Railway.
2. Create a new project.
3. Add a new service from your GitHub repository.
4. Select this repository.

### 3. Add PostgreSQL

1. In the same Railway project, click `New`.
2. Select `Database`.
3. Select `PostgreSQL`.
4. Wait until the Postgres service is running.

### 4. Set environment variables

Open the app service in Railway and go to `Variables`.

Add this variable:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Railway should resolve this value from the PostgreSQL service.

### 5. Check Railway config

The project includes `railway.json`:

```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm run db:migrate && npm run start",
    "buildCommand": "npm run build",
    "healthcheckPath": "/",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

Railway will:

1. Install dependencies.
2. Run `npm run build`.
3. Run Prisma migrations.
4. Start the app with `npm run start`.

### 6. Deploy

Click `Deploy` or `Redeploy` in the Railway app service.

After deploy finishes, open `Networking` or `Settings` and generate a Railway domain for the app service.

## Useful Commands

Generate Prisma client:

```bash
npm run postinstall
```

Run migrations:

```bash
npm run db:migrate
```

Build the app:

```bash
npm run build
```

Start production server:

```bash
npm run start
```
