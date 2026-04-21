const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(cors());

const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.error('ERROR: GROQ_API_KEY environment variable not set');
  process.exit(1);
}

app.get('/', (req, res) => {
  res.json({ status: 'CreatorLens API is running' });
});

function httpsPost(hostname, path, headers, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

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
      contentSummary += `Highlights: ${scrapedData.highlights.join(', ')}\n`;
    }
  }

  const prompt = `You are a world-class content strategist analysing a creator's ${isYT ? 'YouTube' : 'Instagram'} profile.

Scraped data:
---
${contentSummary}
---

Return ONLY valid JSON, no markdown, no explanation:

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
    const result = await httpsPost(
      'api.groq.com',
      '/openai/v1/chat/completions',
      { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1500
      }
    );

    if (result.status !== 200) {
      return res.status(result.status).json({ error: result.body?.error?.message || 'Groq API error' });
    }

    const text = result.body?.choices?.[0]?.message?.content || '';
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
