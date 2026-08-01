# Lamina frontend

React 19, TypeScript, Vite 8, and Tailwind CSS 4 frontend for the Lamina hackathon demo.

## Local development

Start FastAPI from the repository root on `http://127.0.0.1:8001`, then:

```powershell
Set-Location .\frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:5173`. **My Patients** is the default screen and loads Ethan Bell's
authorized synthetic Medplum panel through Lamina FastAPI. OpenAI and Medplum credentials remain
server-side.

`VITE_API_BASE_URL` is the single browser API configuration point. Copying `.env.example` creates
the local `http://127.0.0.1:8001` setting; production builds require an explicit HTTPS value.

## Vercel deployment

Start FastAPI locally on `http://127.0.0.1:8001` and expose it through an HTTPS tunnel. In the
Vercel project settings, set the Production environment variable:

```text
VITE_API_BASE_URL=https://your-current-tunnel-host.example
```

Then redeploy. Vite reads this value at build time. Never use localhost for the deployed value:
localhost in a remote browser means that visitor's computer. Do not add OpenAI keys, Medplum
credentials, or other backend secrets to Vercel; they stay in the FastAPI environment.

To verify a production build locally in PowerShell:

```powershell
$env:VITE_API_BASE_URL = 'https://your-current-tunnel-host.example'
npm run build
```

## Checks

```powershell
npm run lint
$env:VITE_API_BASE_URL = 'https://your-current-tunnel-host.example'
npm run build
```

There is currently no frontend test script. The active pages are **My Patients**, **Network**,
**Review Inbox**, and **Profile**. All domain data and workflow state come from FastAPI; the
frontend contains no fallback patients, posts, articles, responses, or generic clinical chatbot.
