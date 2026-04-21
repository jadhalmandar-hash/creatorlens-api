const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(cors());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-1.5-flash'; // free tier

if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY environment variable not set');
  process.exit(1);
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'CreatorLens API is running' });
});

app.post('/analyse', async (req, res) => {
  const { scrapedData } = req.body;
  if (!scrapedData) return res.status(400).json({ error: 'No scraped data provided' });

  const platform = scrapedData.platform || 'unknown';
  const isYT = platform === 'youtube' || platform === 'youtube-studio';

  let contentSummary = `Platform: ${isYT ? 'YouTube' : 'Instagram'}\n`;

  if (isYT) {
    if (scrapedData.channelName) contentSummary += `Channel: ${scrapedData.channelName}\n`;
    if (scrapedData.videos?.length > 0) {
      contentSummary += `\nVideo titles:\n`;
      scrapedData.videos.slice(0, 30).forEach((v, i) => { contentSummary += `${i+1}. ${v}\n`; });
    }
    if (scrapedData.rawSections?.length > 0) {
      contentSummary += `\nPage content:\n${scrapedData.rawSections.slice(0, 40).join(' | ')}\n`;
    }
  } else {
    if (scrapedData.username) contentSummary += `Username: @${scrapedData.username}\n`;
    if (scrapedData.bio) contentSummary += `Bio: ${scrapedData.bio}\n`;
    if (scrapedData.posts?.length > 0) {
      contentSummary += `\nPost captions:\n`;
      scrapedData.posts.slice(0, 25).forEach((p, i) => { contentSummary += `${i+1}. ${String(p).substring(0, 200)}\n`; });
    }
    if (scrapedData.highlights?.length > 0) {
      contentSummary += `\nHighlights: ${scrapedData.highlights.join(', ')}\n`;
    }
  }

  const prompt = `You are a world-class content strategist analysing a creator's ${isYT ? 'YouTube' : 'Instagram'} profile.

Scraped data:
---
${contentSummary}
---

Return ONLY a valid JSON object, no markdown, no explanation:

{
  "contentScore": <0-100>,
  "scoreBreakdown": { "consistency": <0-100>, "variety": <0-100>, "clarity": <0-100> },
  "voiceAnalysis": "<2-3 sentences on their unique style and tone>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "topTopics": ["<topic 1>", "<topic 2>", "<topic 3>", "<topic 4>", "<topic 5>"],
  "contentGaps": [
    {"gap": "<title>", "explanation": "<why it matters>"},
    {"gap": "<title>", "explanation": "<why it matters>"},
    {"gap": "<title>", "explanation": "<why it matters>"}
  ],
  "viralIdeas": [
    {"title": "<title>", "hook": "<opening line>", "why": "<why it works for this creator>"},
    {"title": "<title>", "hook": "<opening line>", "why": "<why it works>"},
    {"title": "<title>", "hook": "<opening line>", "why": "<why it works>"}
  ]
}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err?.error?.message || 'Gemini API error' });
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();

    try {
      res.json(JSON.parse(clean));
    } catch {
      res.status(500).json({ error: 'Failed to parse AI response' });
    }

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CreatorLens API running on port ${PORT}`));
