# Bulk DR Checker - Vercel

This app checks Domain Rating through a Vercel serverless function. The Ahrefs API key stays on the server and is never sent to the browser.

## Required GitHub structure

Upload the CONTENTS of this folder to GitHub root:

- index.html
- style.css
- app.js
- package.json
- vercel.json
- api/check-dr.js

Do not upload this whole folder as a nested folder.

## Ahrefs API key

Create a new Ahrefs API key and configure it as an environment variable named `AHREFS_API_KEY`.

For local testing, copy `.env.example` to `.env.local` and replace the placeholder value. Never commit `.env.local` or put the key in frontend code.

## Vercel settings

- Framework Preset: Other
- Build Command: leave empty
- Output Directory: leave empty
- Install Command: leave empty or npm install

In Vercel, open the project and go to **Settings → Environment Variables**. Add:

```text
Name: AHREFS_API_KEY
Value: your_new_ahrefs_api_key
```

Select Production (and Preview if needed), save, then redeploy. Environment variable changes only apply to new deployments.

The frontend calls `/api/check-dr?target=example.com`; the serverless function adds the Ahrefs `Authorization: Bearer ...` header.
