const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const POLL_MS = 5 * 60_000; // 5 minutes
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

function readToken() {
  const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
  try {
    const data = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    return data?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

function fetchUsage(token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      USAGE_URL,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'hermes-app/0.1.0',
          Accept: 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch {
            reject(new Error('invalid json'));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

function parseUsage(data) {
  const fh = data.five_hour ?? {};
  const sd = data.seven_day ?? {};
  const ex = data.extra_usage ?? {};
  return {
    fetchedAt: new Date().toISOString(),
    fiveHour: {
      utilization: fh.utilization ?? 0,
      resetsAt: fh.resets_at ?? null,
    },
    sevenDay: {
      utilization: sd.utilization ?? 0,
      resetsAt: sd.resets_at ?? null,
    },
    extraUsage: ex.is_enabled
      ? {
          isEnabled: true,
          utilization: ex.utilization ?? 0,
          usedCredits: ex.used_credits ?? 0,
          monthlyLimit: ex.monthly_limit ?? 0,
        }
      : { isEnabled: false },
  };
}

class UsageWatcher {
  constructor(onUpdate, getEnabled) {
    this._onUpdate = onUpdate;
    this._getEnabled = getEnabled || (() => false);
    this._interval = null;
    this._last = null;
    this._backoffMs = 0;
    this._backoffTimer = null;
  }

  start() {
    this._poll();
    this._interval = setInterval(() => this._poll(), POLL_MS);
  }

  async _poll() {
    if (!this._getEnabled()) return;
    if (this._backoffTimer) return;
    const token = readToken();
    if (!token) return;
    try {
      const { status, data } = await fetchUsage(token);
      if (status === 429 || data?.error?.type === 'rate_limit_error') {
        this._backoffMs = Math.min((this._backoffMs || POLL_MS) * 2, 30 * 60_000);
        const retryAt = new Date(Date.now() + this._backoffMs).toISOString();
        this._backoffTimer = setTimeout(() => { this._backoffTimer = null; }, this._backoffMs);
        console.warn(`[usage] rate limited, backing off ${this._backoffMs / 1000}s`);
        this._last = { rateLimited: true, retryAt };
        this._onUpdate(this._last);
        return;
      }
      this._backoffMs = 0;
      if (data.five_hour !== undefined) {
        this._last = parseUsage(data);
        this._onUpdate(this._last);
      }
    } catch (e) {
      console.warn('[usage] fetch failed:', e.message);
    }
  }

  current() {
    return this._last;
  }

  stop() {
    clearInterval(this._interval);
    clearTimeout(this._backoffTimer);
    this._interval = null;
    this._backoffTimer = null;
  }
}

module.exports = { UsageWatcher };
