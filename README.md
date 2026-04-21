# Daily Blacklist Monitoring and Email Report Engine

Automated daily security tool that checks IPs and domains against multiple
blacklist/reputation sources, generates a formatted Excel report, and emails
it to you automatically every morning.

## Features

- **Multi-source checks** – AbuseIPDB, VirusTotal, HetrixTools (modular, easily extendable)
- **Excel report** – Summary sheet, Detailed Results sheet, Changes/Diff sheet
- **Email delivery** – Sends the Excel file as an attachment via Nodemailer/SMTP
- **Daily scheduling** – Configurable cron expression and timezone
- **Diff tracking** – Shows what changed since yesterday (new blacklistings, clearances, score changes)
- **Dashboard** – Simple web UI to view results and trigger manual runs
- **REST API** – Endpoints to trigger runs, view results, download reports
- **History log** – JSON scan history saved per day in `/data/history/`
- **Manual test mode** – `node server.js --test` to run once and exit

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/philr029/Domain-test-engine-
cd Domain-test-engine-
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in your API keys and SMTP settings
```

### 3. Add your targets

Edit `data/targets.json`:

```json
[
  { "target": "8.8.8.8",     "type": "ip",     "label": "Google DNS"   },
  { "target": "example.com", "type": "domain",  "label": "My Website"  }
]
```

### 4. Run

```bash
# Start the server (with cron scheduler)
npm start

# OR run a single scan immediately and exit (test mode)
node server.js --test
```

The dashboard is available at **http://localhost:3000**.

---

## Environment Variables

| Variable              | Required | Description                                       |
|-----------------------|----------|---------------------------------------------------|
| `ABUSEIPDB_API_KEY`   | No*      | AbuseIPDB API key                                 |
| `VIRUSTOTAL_API_KEY`  | No*      | VirusTotal API v3 key                             |
| `HETRIXTOOLS_API_KEY` | No*      | HetrixTools API key                               |
| `SMTP_HOST`           | Yes      | SMTP server hostname (e.g. `smtp.gmail.com`)      |
| `SMTP_PORT`           | Yes      | SMTP port (587 for TLS, 465 for SSL)              |
| `SMTP_USER`           | Yes      | SMTP username / email                             |
| `SMTP_PASS`           | Yes      | SMTP password or App Password                     |
| `REPORT_EMAIL_FROM`   | No       | From address (defaults to `SMTP_USER`)            |
| `REPORT_EMAIL_TO`     | Yes      | Recipient email address                           |
| `CRON_SCHEDULE`       | No       | Cron expression, default `0 8 * * *` (08:00 UTC) |
| `CRON_TIMEZONE`       | No       | IANA timezone, default `UTC`                      |
| `EMAIL_ONLY_ON_CHANGE`| No       | `true` to skip email when nothing changed         |
| `PORT`                | No       | HTTP server port, default `3000`                  |

\* At least one API key should be set; providers without keys are gracefully skipped.

---

## API Endpoints

| Method | Path          | Description                            |
|--------|---------------|----------------------------------------|
| `GET`  | `/`           | Dashboard UI                           |
| `GET`  | `/api/status` | Job status (`idle` / `running`)        |
| `POST` | `/api/run`    | Manually trigger a scan                |
| `GET`  | `/api/results`| Latest scan results (JSON)             |
| `GET`  | `/api/report` | Download latest Excel report           |

---

## Project Structure

```
├── server.js              # Express app entry point
├── api/
│   └── routes.js          # API routes
├── jobs/
│   └── dailyReportJob.js  # Cron scheduler + job runner
├── services/
│   ├── abuseipdb.js       # AbuseIPDB checker
│   ├── virustotal.js      # VirusTotal checker
│   └── hetrixtools.js     # HetrixTools checker
├── utils/
│   ├── scoring.js         # Verdict aggregation
│   ├── excelReport.js     # Excel report generator
│   └── sendEmail.js       # Nodemailer email sender
├── data/
│   ├── targets.json       # Your monitored IPs/domains
│   └── history/           # Per-day scan history (auto-created)
├── reports/               # Generated Excel files (auto-created)
├── frontend/
│   └── index.html         # Dashboard UI
├── .env.example           # Environment variable template
└── package.json
```

---

## Adding More Blacklist Providers

Create a new file in `/services/`:

```js
// services/myprovider.js
async function check(target, type) {
  // ... call your API ...
  return {
    target, type,
    source: 'MyProvider',
    status: 'clean',          // 'clean' | 'suspicious' | 'blacklisted' | 'error'
    confidence_score: 0,      // 0–100
    details: 'All clear',
    checked_at: new Date().toISOString(),
  };
}
module.exports = { check };
```

Then add it to the `services` array in `utils/scoring.js`:

```js
const services = [
  require('../services/abuseipdb'),
  require('../services/virustotal'),
  require('../services/hetrixtools'),
  require('../services/myprovider'), // <-- add here
];
```

---

## Deployment

### Render / Railway / VPS (recommended for cron jobs)

1. Set all environment variables in the platform dashboard.
2. Set the start command to `npm start`.
3. The cron scheduler runs in-process — no extra worker needed.

### Vercel

Vercel does not support long-running processes. For Vercel deployments:
- Use the `/api/run` endpoint triggered by an external cron service (e.g., cron-job.org, GitHub Actions schedule).
- The serverless functions handle the report generation and email sending.

---

## Gmail / App Passwords

If using Gmail as your SMTP provider:
1. Enable 2-factor authentication on your Google account.
2. Go to **Google Account → Security → App passwords**.
3. Generate an app password and use it as `SMTP_PASS`.

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your_16_char_app_password
```

---

## License

MIT