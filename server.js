const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(cors());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) { console.error('ERROR: GROQ_API_KEY not set'); process.exit(1); }

app.get('/', (req, res) => res.json({ status: 'CreatorLens API running' }));

function httpsPost(hostname, path, headers, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
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
  const { scrapedData: d } = req.body;
  if (!d) return res.status(400).json({ error: 'No data' });

  const isYT = d.platform === 'youtube' || d.platform === 'youtube-studio';
  let summary = `Platform: ${isYT ? 'YouTube' : 'Instagram'}\n`;
  if (d.username) summary += `Username: @${d.username}\n`;
  if (d.fullName) summary += `Name: ${d.fullName}\n`;
  if (d.bio) summary += `Bio: ${d.bio}\n`;
  if (d.followers) summary += `Followers: ${d.followers}\n`;
  if (d.totalPosts) summary += `Total posts: ${d.totalPosts}\n`;
  if (d.posts?.length > 0) {
    summary += `\nPost captions:\n`;
    d.posts.slice(0, 20).forEach((p, i) => { summary += `${i+1}. ${String(p).substring(0, 200)}\n`; });
  }
  if (d.videos?.length > 0) {
    summary += `\nVideo titles:\n`;
    d.videos.slice(0, 20).forEach((v, i) => { summary += `${i+1}. ${v}\n`; });
  }

  const prompt = `You are a content intelligence analyst. Analyse this creator's profile and return ONLY valid JSON.

Profile data:
---
${summary}
---

Return this exact JSON structure with no extra text:
{
  "contentScore": <0-100>,
  "scoreBreakdown": {"consistency": <0-100>, "variety": <0-100>, "clarity": <0-100>},
  "voiceAnalysis": "<2-3 sentences on their unique style, tone, and what makes them distinct>",
  "strengths": ["<strength>", "<strength>", "<strength>"],
  "topTopics": ["<topic>", "<topic>", "<topic>", "<topic>", "<topic>"],
  "contentGaps": [
    {"gap": "<gap>", "explanation": "<why it matters>"},
    {"gap": "<gap>", "explanation": "<why it matters>"},
    {"gap": "<gap>", "explanation": "<why it matters>"}
  ],
  "viralIdeas": [
    {"title": "<title>", "hook": "<opening line>", "why": "<why it works for this creator>"},
    {"title": "<title>", "hook": "<opening line>", "why": "<why it works>"},
    {"title": "<title>", "hook": "<opening line>", "why": "<why it works>"}
  ],
  "similarCreators": [
    {"name": "<Creator Name>", "handle": "@<handle>", "niche": "<their niche>"},
    {"name": "<Creator Name>", "handle": "@<handle>", "niche": "<their niche>"},
    {"name": "<Creator Name>", "handle": "@<handle>", "niche": "<their niche>"}
  ]
}

For similarCreators, suggest 3 real Instagram creators in the same niche as this creator.`;

  try {
    const result = await httpsPost('api.groq.com', '/openai/v1/chat/completions',
      { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a JSON API. Output only valid JSON, no markdown, no explanation.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7, max_tokens: 2000
      }
    );

    if (result.status !== 200) {
      return res.status(result.status).json({ error: result.body?.error?.message || 'Groq error' });
    }

    const text = result.body?.choices?.[0]?.message?.content || '';
    console.log('Raw:', text.substring(0, 150));

    let parsed = null;
    try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); } catch {}
    if (!parsed) { try { const m = text.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {} }

    if (parsed) return res.json(parsed);
    res.status(500).json({ error: 'Parse failed: ' + text.substring(0, 100) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CreatorLens API on port ${PORT}`));
