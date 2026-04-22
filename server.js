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

function detectFollowerTier(followers) {
  if (followers < 10000) return 'nano (under 10K followers)';
  if (followers < 100000) return 'micro (10K–100K followers)';
  if (followers < 500000) return 'mid-tier (100K–500K followers)';
  if (followers < 1000000) return 'macro (500K–1M followers)';
  return 'mega (1M+ followers)';
}

function detectLanguage(bio, posts) {
  const allText = (bio + ' ' + (posts || []).join(' ')).toLowerCase();
  // Simple language hints
  const tamilChars = /[\u0B80-\u0BFF]/.test(allText);
  const kannadaChars = /[\u0C80-\u0CFF]/.test(allText);
  const hindiChars = /[\u0900-\u097F]/.test(allText);
  const teluguChars = /[\u0C00-\u0C7F]/.test(allText);
  const malayalamChars = /[\u0D00-\u0D7F]/.test(allText);
  
  if (tamilChars) return 'Tamil';
  if (kannadaChars) return 'Kannada';
  if (hindiChars) return 'Hindi';
  if (teluguChars) return 'Telugu';
  if (malayalamChars) return 'Malayalam';
  
  // English keywords that suggest regional Indian content
  if (allText.includes('tamil') || allText.includes('chennai') || allText.includes('tamilnadu')) return 'Tamil';
  if (allText.includes('kannada') || allText.includes('bangalore') || allText.includes('bengaluru')) return 'Kannada';
  if (allText.includes('telugu') || allText.includes('hyderabad')) return 'Telugu';
  if (allText.includes('malayalam') || allText.includes('kerala')) return 'Malayalam';
  if (allText.includes('hindi') || allText.includes('mumbai') || allText.includes('delhi')) return 'Hindi';
  
  return 'English';
}

app.post('/analyse', async (req, res) => {
  const { scrapedData: d } = req.body;
  if (!d) return res.status(400).json({ error: 'No data' });

  const followerTier = detectFollowerTier(d.followers || 0);
  const language = detectLanguage(d.bio || '', d.posts || []);

  let summary = `Platform: Instagram\n`;
  if (d.username) summary += `Username: @${d.username}\n`;
  if (d.fullName) summary += `Name: ${d.fullName}\n`;
  if (d.bio) summary += `Bio: ${d.bio}\n`;
  if (d.followers) summary += `Followers: ${d.followers} (${followerTier})\n`;
  if (d.totalPosts) summary += `Total posts: ${d.totalPosts}\n`;
  if (d.posts?.length > 0) {
    summary += `\nRecent post captions:\n`;
    d.posts.slice(0, 20).forEach((p, i) => { summary += `${i+1}. ${String(p).substring(0, 200)}\n`; });
  }

  const prompt = `You are a content intelligence analyst for Indian social media creators. Analyse this creator's profile carefully.

Profile data:
---
${summary}
Detected language: ${language}
Follower tier: ${followerTier}
---

Return ONLY this exact JSON with no extra text, no markdown:

{
  "contentScore": <0-100>,
  "scoreBreakdown": {
    "consistency": <0-100>,
    "variety": <0-100>,
    "clarity": <0-100>
  },
  "voiceAnalysis": "<2-3 sentences describing their specific communication style, language, tone, and what makes them genuinely distinct from others in their niche>",
  "strengths": ["<specific strength>", "<specific strength>", "<specific strength>"],
  "topTopics": ["<specific topic>", "<specific topic>", "<specific topic>", "<specific topic>", "<specific topic>"],
  "contentGaps": [
    {"gap": "<specific gap>", "explanation": "<actionable reason why this matters for THIS creator>"},
    {"gap": "<specific gap>", "explanation": "<actionable reason>"},
    {"gap": "<specific gap>", "explanation": "<actionable reason>"}
  ],
  "viralIdeas": [
    {"title": "<specific title in their style>", "hook": "<opening line that matches their voice>", "why": "<specific reason this works for this exact creator>"},
    {"title": "<specific title>", "hook": "<opening line>", "why": "<specific reason>"},
    {"title": "<specific title>", "hook": "<opening line>", "why": "<specific reason>"}
  ],
  "similarCreators": [
    {"name": "<Real Creator Name>", "handle": "@<real_instagram_handle>", "niche": "<specific niche>", "size": "<follower count approx>"},
    {"name": "<Real Creator Name>", "handle": "@<real_instagram_handle>", "niche": "<specific niche>", "size": "<follower count approx>"},
    {"name": "<Real Creator Name>", "handle": "@<real_instagram_handle>", "niche": "<specific niche>", "size": "<follower count approx>"}
  ]
}

CRITICAL RULES FOR similarCreators:
- The similar creators MUST be from the SAME language/region as this creator (${language} language creators)
- They MUST be in the same or adjacent niche
- They MUST be similar in size: ${followerTier} — do NOT suggest massive global creators if this is a small creator
- Suggest REAL Indian regional creators, not global celebrities
- If you cannot find real creators, suggest ones that definitely exist in that niche and tier`;

  try {
    const result = await httpsPost('api.groq.com', '/openai/v1/chat/completions',
      { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a JSON API that specialises in Indian creator economy. Output only valid JSON. Never add explanation or markdown.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.6,
        max_tokens: 2000
      }
    );

    if (result.status !== 200) {
      return res.status(result.status).json({ error: result.body?.error?.message || 'Groq error' });
    }

    const text = result.body?.choices?.[0]?.message?.content || '';
    let parsed = null;
    try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); } catch {}
    if (!parsed) { try { const m = text.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {} }

    if (parsed) return res.json(parsed);
    console.error('Parse failed:', text.substring(0, 200));
    res.status(500).json({ error: 'Parse failed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CreatorLens API on port ${PORT}`));
