const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(cors());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) { console.error('ERROR: GROQ_API_KEY not set'); process.exit(1); }

app.get('/', (req, res) => res.json({ status: 'ok' }));

function post(hostname, path, headers, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers } },
      res => { let r = ''; res.on('data', c => r += c); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(r) }); } catch { resolve({ status: res.statusCode, body: r }); } }); }
    );
    req.on('error', reject); req.write(body); req.end();
  });
}

function followerTier(n) {
  if (n < 10000) return 'nano (under 10K)';
  if (n < 100000) return 'micro (10K–100K)';
  if (n < 500000) return 'mid-tier (100K–500K)';
  if (n < 1000000) return 'macro (500K–1M)';
  return 'mega (1M+)';
}

function detectLang(bio, posts) {
  const t = (bio + ' ' + (posts||[]).join(' ')).toLowerCase();
  if (/[\u0B80-\u0BFF]/.test(t) || t.includes('tamil') || t.includes('chennai')) return 'Tamil';
  if (/[\u0C80-\u0CFF]/.test(t) || t.includes('kannada') || t.includes('bengaluru') || t.includes('bangalore')) return 'Kannada';
  if (/[\u0900-\u097F]/.test(t) || t.includes(' hindi ') || t.includes('mumbai') || t.includes('delhi')) return 'Hindi';
  if (/[\u0C00-\u0C7F]/.test(t) || t.includes('telugu') || t.includes('hyderabad')) return 'Telugu';
  if (/[\u0D00-\u0D7F]/.test(t) || t.includes('malayalam') || t.includes('kerala')) return 'Malayalam';
  if (/[\u0A00-\u0A7F]/.test(t) || t.includes('punjabi')) return 'Punjabi';
  return 'English';
}

app.post('/analyse', async (req, res) => {
  const d = req.body?.scrapedData;
  if (!d) return res.status(400).json({ error: 'No data' });

  const tier = followerTier(d.followers || 0);
  const lang = detectLang(d.bio || '', d.posts || []);

  let profile = `Username: @${d.username || 'unknown'}\n`;
  if (d.fullName) profile += `Name: ${d.fullName}\n`;
  if (d.bio) profile += `Bio: ${d.bio}\n`;
  if (d.followers) profile += `Followers: ${d.followers} (${tier})\n`;
  if (d.totalPosts) profile += `Total posts: ${d.totalPosts}\n`;
  if (d.posts?.length) {
    profile += `\nRecent post captions (${d.posts.length} posts):\n`;
    d.posts.slice(0, 25).forEach((p, i) => { profile += `${i+1}. ${String(p).substring(0, 200)}\n`; });
  }

  const prompt = `You are a senior creator economy analyst specialising in Indian regional content. Analyse this Instagram creator deeply.

PROFILE:
${profile}
Detected language: ${lang}
Follower tier: ${tier}

Return ONLY a valid JSON object. No markdown. No explanation. Just JSON.

{
  "contentScore": <0-100, be honest and specific>,
  "scoreBreakdown": {
    "consistency": <0-100, based on posting regularity signals>,
    "variety": <0-100, based on topic/format range>,
    "clarity": <0-100, based on niche clarity and positioning>
  },
  "voiceAnalysis": "<3-4 sentences. Describe their specific tone, language style, how they communicate, what makes their content style recognisable. Be specific to this creator, not generic.>",
  "nicheEngagementBenchmark": {
    "medianEngagement": "<typical median ER % for creators in this exact niche and language, as a number string e.g. '2.5'>",
    "context": "<1-2 sentences explaining what's normal for this category — e.g. finance creators in regional Indian languages typically see X% because Y>"
  },
  "topPerformingFormats": [
    {"format": "<specific content format that works for this creator's niche>", "reason": "<why this format performs well for their specific audience>"},
    {"format": "<format>", "reason": "<reason>"},
    {"format": "<format>", "reason": "<reason>"}
  ],
  "strengths": ["<specific, not generic>", "<specific>", "<specific>"],
  "topTopics": ["<topic>", "<topic>", "<topic>", "<topic>", "<topic>"],
  "contentGaps": [
    {"gap": "<specific missing content type>", "explanation": "<detailed why — what audience need is unmet, what competitors do that this creator doesn't>", "example": "<a concrete example post title they could make>"},
    {"gap": "<gap>", "explanation": "<detailed explanation>", "example": "<concrete example>"},
    {"gap": "<gap>", "explanation": "<detailed explanation>", "example": "<concrete example>"}
  ],
  "viralIdeas": [
    {"title": "<specific title matching this creator's voice and language style>", "hook": "<opening line in their style>", "why": "<specific reason this will work for THIS creator's audience>"},
    {"title": "<title>", "hook": "<hook>", "why": "<why>"},
    {"title": "<title>", "hook": "<hook>", "why": "<why>"}
  ],
  "similarCreators": [
    {"name": "<Real creator name>", "handle": "@<real_handle>", "niche": "<their niche>", "size": "<approx followers>", "whySimlar": "<one sentence on why they're comparable>"},
    {"name": "<Real creator name>", "handle": "@<real_handle>", "niche": "<their niche>", "size": "<approx followers>", "whySimlar": "<why comparable>"},
    {"name": "<Real creator name>", "handle": "@<real_handle>", "niche": "<their niche>", "size": "<approx followers>", "whySimlar": "<why comparable>"}
  ]
}

STRICT RULES:
1. similarCreators MUST be ${lang}-language creators only. No English-only global creators.
2. similarCreators MUST be ${tier} — similar follower range. No celebrities or mega-influencers if this is micro/nano.
3. similarCreators must be in the same niche as this creator.
4. contentGaps must be specific to what THIS creator is missing, not generic advice.
5. nicheEngagementBenchmark must reflect ${lang} ${d.bio?.includes('finance')||d.bio?.includes('business') ? 'finance/business' : 'general'} creators specifically.`;

  try {
    const result = await post('api.groq.com', '/openai/v1/chat/completions',
      { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a JSON-only API. Return only valid JSON, no markdown, no explanation, no preamble.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.5, max_tokens: 2500
      }
    );

    if (result.status !== 200) return res.status(result.status).json({ error: result.body?.error?.message || 'Groq error' });

    const text = result.body?.choices?.[0]?.message?.content || '';
    let parsed = null;
    try { parsed = JSON.parse(text.replace(/```json|```/g,'').trim()); } catch {}
    if (!parsed) { try { const m = text.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {} }

    if (parsed) return res.json(parsed);
    console.error('Parse fail. Raw:', text.substring(0, 300));
    res.status(500).json({ error: 'Failed to parse response' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CreatorLens running on ${PORT}`));
