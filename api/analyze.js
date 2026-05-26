import { getSession, logUsage } from './_helpers.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { transcript, companyName, callType = 'general', includeCoaching = false } = req.body;
    if (!transcript) return res.status(400).json({ error: 'No transcript provided' });

    const baseFields = `
  "summary": "2-3 sentence summary of the call",
  "callNotes": "Detailed notes about what was discussed, objections, interest level, next steps",
  "followUpCommitment": "Exact quote or description of any follow-up commitment made, or null",
  "followUpDate": "ISO date string for follow-up (calculate from today ${new Date().toISOString().split('T')[0]}), or null",
  "followUpTitle": "Short title for calendar event, or null",
  "sentiment": "positive|neutral|negative",
  "interested": true or false`;

    const salesFields = `
  "salesNotes": {
    "customerGoals": "What are the customer's goals with Olly Olly? Be specific.",
    "painPoints": "What are the customer's pain points? Be specific.",
    "currentCompany": "Is the client currently with another marketing company? If yes, who and what are they doing? If no, say No current provider.",
    "primaryServices": "What are the top services they provide or want to showcase?"
  }`;

    const demoFields = `
  "demoNotes": {
    "currentProviderExperience": "Their experience with current provider or lead gen company",
    "businessGoals": "Goals for the business — additional jobs per week/month, anything else",
    "currentMarketing": "What marketing are they currently doing?",
    "anticipatedObjections": "What objections do you anticipate based on the call?",
    "painLeverage": "What are the key pain points and leverage points?",
    "soleDecisionMaker": "Are they the sole decision maker? Who else is involved?",
    "contactInfo": "Contact info mentioned on the call",
    "demoDateTime": "Demo date and time if mentioned, or null",
    "additional": "Anything additional worth noting"
  }`;

const coachingFields = `
  "coachingNotes": {
    "intro": { "score": 3, "notes": "Feedback on intro" },
    "elevatorPitch": { "score": 3, "notes": "Feedback on probing questions and active listening" },
    "otf": { "score": 3, "notes": "Feedback on confidence assuming time and avoiding objections" },
    "settingDemo": { "score": 3, "notes": "Feedback on uncovering DM needs" },
    "website": { "score": 3, "notes": "Feedback on website pain point questions" },
    "confirmingDMs": { "score": 3, "notes": "Feedback on confirming decision makers" },
    "recap": { "score": 3, "notes": "Feedback on recap and confirming time" },
    "pace": { "score": 3, "notes": "Feedback on pace" },
    "tonality": { "score": 3, "notes": "Feedback on tonality" },
    "listening": { "score": 3, "notes": "Feedback on active listening" },
    "communication": { "score": 3, "notes": "Feedback on avoiding verbal crutches" },
    "tailoredPitch": { "score": 3, "notes": "Feedback on tailoring pitch to DM" },
    "overall": "Overall coaching feedback and top 2-3 things to improve"
  }`;

    const typeFields = {
      general: '',
      sales: `,\n${salesFields}`,
      demo: `,\n${demoFields}`,
    }[callType] || '';

    const extraFields = typeFields + (includeCoaching ? `,\n${coachingFields}` : '');

    const prompt = `You are analyzing a sales call transcript for an SEO agency that sells to home service contractors.

Company: ${companyName || 'Unknown'}
Call Type: ${callType}
Transcript: ${transcript}

Extract and return ONLY a JSON object with these fields, no other text:
{
${baseFields}${extraFields}
}`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) throw new Error(`Anthropic error: ${data.error?.message || JSON.stringify(data)}`);

    const analysisText = data.content?.[0]?.text || '';
    if (!analysisText) throw new Error('Claude returned empty response');

    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = await getSession(token);
    if (session?.email) {
      logUsage(session.email, {
        claude_input: data.usage?.input_tokens || 0,
        claude_output: data.usage?.output_tokens || 0,
        calls: 1,
      }).catch(() => {});
    }

    let analysis;
    try {
      const clean = analysisText.replace(/```json|```/g, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      analysis = JSON.parse(jsonMatch ? jsonMatch[0] : clean);
    } catch {
      analysis = { summary: 'Could not parse analysis', callNotes: analysisText };
    }

    return res.status(200).json({ analysis });
  } catch (err) {
    console.error('Analyze error:', err);
    return res.status(500).json({ error: err.message });
  }
}
