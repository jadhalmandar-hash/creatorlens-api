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

  const prompt = `You are a content strategist. Analyse this creator's profile data and return ONLY a JSON object. No explanation, no markdown, no text before or after. Just the raw JSON.

Profile data:
---
${contentSummary}
---

JSON format to return:
{"contentScore":85,"scoreBreakdown":{"consistency":80,"variety":75,"clarity":90},"voiceAnalysis":"Their tone is conversational and direct.","strengths":["Strong niche","Consistent posting","Good engagement"],"topTopics":["Topic 1","Topic 2","Topic 3","Topic 4","Topic 5"],"contentGaps":[{"gap":"Behind the scenes","explanation":"Audiences love transparency"},{"gap":"Q&A content","explanation":"Builds direct connection"},{"gap":"Collab content","explanation":"Expands reach"}],"viralIdeas":[{"title":"Video title here","hook":"Opening line here","why":"Why it works"},{"title":"Video title here","hook":"Opening line here","why":"Why it works"},{"title":"Video title here","hook":"Opening line here","why":"Why it works"}]}

Now return the same structure filled with real analysis for this creator. Return ONLY the JSON, nothing else.`;

  try {
    const result = await httpsPost(
      'api.groq.com',
      '/openai/v1/chat/completions',
      { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a JSON API. You only output valid JSON. Never add explanation or markdown.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1500
      }
    );

    console.log('Groq status:', result.status);
    
    if (result.status !== 200) {
      console.error('Groq error:', JSON.stringify(result.body));
      return res.status(result.status).json({ error: result.body?.error?.message || 'Groq API error' });
    }

    const text = result.body?.choices?.[0]?.message?.content || '';
    console.log('Raw response:', text.substring(0, 200));

    let parsed = null;
    try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); } catch {}
    if (!parsed) {
      try { const match = text.match(/\{[\s\S]*\}/); if (match) parsed = JSON.parse(match[0]); } catch {}
    }

    if (parsed) {
      res.json(parsed);
    } else {
      console.error('Could not parse:', text);
      res.status(500).json({ error: 'Failed to parse AI response: ' + text.substring(0, 100) });
    }

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CreatorLens API running on port ${PORT}`));
