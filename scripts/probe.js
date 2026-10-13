// Etapa 0: valida o endpoint de uso. Imprime só a ESTRUTURA da resposta (nunca o token).
const fs = require('fs');
const os = require('os');
const path = require('path');

const cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8')).claudeAiOauth;
console.log('token expira em:', new Date(cred.expiresAt).toISOString(), '| plano:', cred.subscriptionType);

(async () => {
  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      Authorization: `Bearer ${cred.accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-usage-widget/0.1',
    },
  });
  console.log('status:', res.status);
  const text = await res.text();
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text.slice(0, 300));
  }
})().catch((e) => console.error('erro:', e.message));
