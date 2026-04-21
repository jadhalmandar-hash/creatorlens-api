# CreatorLens Backend

Uses **Google Gemini** (free, no credit card needed).

## Get your free API key (2 min)
1. Go to aistudio.google.com
2. Click "Get API Key" → Create API key
3. Copy it — that's it, no billing needed

## Deploy free on Railway
1. Push this folder to a GitHub repo
2. railway.app → New Project → Deploy from GitHub
3. Variables tab → add: GEMINI_API_KEY = your-key-here
4. Deploy → copy your URL

## After deploying
In creator-lens-v2/popup.js, update line 5:
  const BACKEND_URL = 'https://your-app.up.railway.app';

Then reload the extension.

## Free tier limits
- 1,500 requests/day
- 15 requests/minute
More than enough for testing and early users.
