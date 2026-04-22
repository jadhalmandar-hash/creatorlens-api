const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(cors());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) { console.error('GROQ_API_KEY not set'); process.exit(1); }

app.get('/', (_, res) => res.json({ status: 'ok' }));

function post(host, path, hdrs, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request(
      { hostname: host, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...hdrs } },
      res => { let r = ''; res.on('data', c => r += c); res.on('end', () => { try { resolve({ s: res.statusCode, b: JSON.parse(r) }); } catch { resolve({ s: res.statusCode, b: r }); } }); }
    );
    req.on('error', reject); req.write(body); req.end();
  });
}

function tier(n) {
  if (n < 10000) return 'nano (under 10K)';
  if (n < 100000) return 'micro (10K–100K)';
  if (n < 500000) return 'mid-tier (100K–500K)';
  return n < 1000000 ? 'macro (500K–1M)' : 'mega (1M+)';
}

function lang(bio, posts) {
  const t = (bio + ' ' + (posts || []).join(' ')).toLowerCase();
  if (/[\u0B80-\u0BFF]/.test(t) || t.includes('tamil') || t.includes('chennai') || t.includes('tamilnadu')) return 'Tamil';
  if (/[\u0C80-\u0CFF]/.test(t) || t.includes('kannada') || t.includes('bengaluru') || t.includes('bangalore')) return 'Kannada';
  if (/[\u0C00-\u0C7F]/.test(t) || t.includes('telugu') || t.includes('hyderabad')) return 'Telugu';
  if (/[\u0D00-\u0D7F]/.test(t) || t.includes('malayalam') || t.includes('kerala')) return 'Malayalam';
  if (/[\u0900-\u097F]/.test(t) || t.includes('mumbai') || t.includes('delhi')) return 'Hindi';
  return 'English';
}

app.post('/analyse', async (req, res) => {
  const d = req.body?.scrapedData;
  if (!d) return res.status(400).json({ error: 'No data' });

  const creatorTier = tier(d.followers || 0);
  const creatorLang = lang(d.bio || '', d.posts || []);
  const isFinance = /finance|business|money|invest|startup|economy|stock|mutual fund|crypto/i.test((d.bio || '') + (d.posts || []).join(' '));
  const niche = isFinance ? 'finance/business' : 'general lifestyle/education';

  let profile = '';
  if (d.username) profile += `Username: @${d.username}\n`;
  if (d.fullName) profile += `Name: ${d.fullName}\n`;
  if (d.bio) profile += `Bio: ${d.bio}\n`;
  if (d.followers) profile += `Followers: ${d.followers} (${creatorTier})\n`;
  if (d.totalPosts) profile += `Total posts: ${d.totalPosts}\n`;
  if (d.posts?.length) {
    profile += `\nRecent post captions:\n`;
    d.posts.slice(0, 20).forEach((p, i) => { profile += `${i + 1}. ${String(p).substring(0, 180)}\n`; });
  }

  const prompt = `You are a senior creator economy analyst for Indian regional content. Give a deep, accurate analysis.

PROFILE:
${profile}
Language: ${creatorLang}
Tier: ${creatorTier}  
Niche: ${niche}

Return ONLY valid JSON (no markdown, no text outside JSON):

{
  "contentScore": <0-100, honest score>,
  "scoreBreakdown": {
    "consistency": <0-100>,
    "variety": <0-100>,
    "clarity": <0-100>
  },
  "voiceAnalysis": "<3-4 specific sentences about their communication style, language register, tone, hooks they use, what makes them recognisable — be specific to this creator>",
  "nicheEngagementBenchmark": {
    "medianEngagement": "<typical median ER % for ${creatorLang} ${niche} creators at this tier, as a decimal string like '2.1'>",
    "context": "<2 sentences on what's normal ER for ${creatorLang} ${niche} creators at ${creatorTier} tier and why>"
  },
  "topPerformingFormats": [
    {"format": "<content format that works in this niche>", "reason": "<why it works for their specific audience>"},
    {"format": "<format>", "reason": "<reason>"},
    {"format": "<format>", "reason": "<reason>"}
  ],
  "strengths": ["<specific strength unique to this creator>", "<strength>", "<strength>"],
  "topTopics": ["<topic>", "<topic>", "<topic>", "<topic>", "<topic>"],
  "contentGaps": [
    {"gap": "<specific gap>", "explanation": "<detailed explanation of what audience need is unmet and why it matters for THIS creator>", "example": "<concrete example post title they could create>"},
    {"gap": "<gap>", "explanation": "<explanation>", "example": "<example>"},
    {"gap": "<gap>", "explanation": "<explanation>", "example": "<example>"}
  ],
  "viralIdeas": [
    {"title": "<title in their exact style and language>", "hook": "<opening line that matches their voice>", "why": "<specific reason this works for this creator's audience>"},
    {"title": "<title>", "hook": "<hook>", "why": "<why>"},
    {"title": "<title>", "hook": "<hook>", "why": "<why>"}
  ],
  "similarCreators": [
    {"name": "<Real name>", "handle": "@<real_instagram_handle>", "niche": "<their niche>", "size": "<approx follower count>", "whySimlar": "<one sentence why they are comparable to this creator>"},
    {"name": "<Real name>", "handle": "@<handle>", "niche": "<niche>", "size": "<size>", "whySimlar": "<why>"},
    {"name": "<Real name>", "handle": "@<handle>", "niche": "<niche>", "size": "<size>", "whySimlar": "<why>"}
  ]
}

HARD RULES:
1. similarCreators: ONLY ${creatorLang}-language creators. ZERO English-only global creators if this is regional.
2. similarCreators: ONLY ${creatorTier} range creators — no celebrities or mega influencers.
3. contentGaps: Must be specific actionable gaps for THIS creator, not generic advice.
4. All analysis must reflect actual ${creatorLang} regional creator market realities.`;

  try {
    const result = await post('api.groq.com', '/openai/v1/chat/completions',
      { Authorization: `Bearer ${GROQ_API_KEY}` },
      { model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: 'JSON only API. No markdown. No text before or after JSON.' }, { role: 'user', content: prompt }], temperature: 0.5, max_tokens: 2500 }
    );

    if (result.s !== 200) return res.status(result.s).json({ error: result.b?.error?.message || 'API error' });

    const text = result.b?.choices?.[0]?.message?.content || '';
    let parsed = null;
    try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); } catch {}
    if (!parsed) { try { const m = text.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {} }

    if (parsed) return res.json(parsed);
    res.status(500).json({ error: 'Parse failed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log('CreatorLens running'));
