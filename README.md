# Olly Olly Virtual Assistant

AI-powered CRM built on top of HubSpot. Features:
- 📞 Smart call queue (who to call and when)
- 🔔 Follow-up tracking
- ✨ AI assistant (drafts emails, call scripts, coaching)
- 📊 Pipeline view
- 🎯 Sales coaching & objection handling
- 📝 Notes & call logging (syncs to HubSpot)

---

## Deploy to Vercel (5 minutes)

### Step 1 — Install Vercel CLI
```
npm install -g vercel
```

### Step 2 — Set your environment variables
In Vercel dashboard after deploying, go to Settings → Environment Variables and add:

| Variable | Value |
|---|---|
| `HUBSPOT_CLIENT_ID` | `aef5fc9a-c12b-45a6-953f-b77e99dc08f7` |
| `HUBSPOT_CLIENT_SECRET` | `790548a3-f931-4aa3-a2bf-f1d210966410` |
| `HUBSPOT_REFRESH_TOKEN` | *(your refresh token)* |
| `ANTHROPIC_API_KEY` | *(your Anthropic API key)* |

### Step 3 — Deploy
```
cd olly-olly-va
vercel --prod
```

Vercel will give you a URL like `olly-olly-va.vercel.app`. Send that URL to your team — she just opens it in any browser.

---

## Local development

```bash
npm install -g vercel
cd olly-olly-va
cp .env.example .env
# Fill in .env with real values
vercel dev
# Opens at http://localhost:3000
```

---

## HubSpot scopes required
- `crm.objects.contacts.read`
- `crm.objects.contacts.write`
- `crm.objects.companies.read`
- `crm.objects.companies.write`
- `crm.objects.deals.read`
- `crm.objects.notes.write`
- `oauth`

These are already set in your Chrome extension's OAuth app — no changes needed.
