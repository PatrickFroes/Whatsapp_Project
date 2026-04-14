#!/usr/bin/env node

/**
 * webhook_diagnostic.js
 *
 * Diagnostico automatizado para webhook Meta WhatsApp.
 *
 * Uso basico:
 *   node scripts/webhook_diagnostic.js
 *
 * Com variaveis opcionais:
 *   WEBHOOK_URL="https://broker.amber.com.br/webhook"
 *   WEBHOOK_VERIFY_TOKEN="..."
 *   PHONE_NUMBER_ID="..."
 *   META_APP_SECRET="..."
 *   WABA_ID="..."
 *   SYSTEM_USER_ACCESS_TOKEN="..."
 *   EXPECTED_IP="172.233.26.198"
 *   node scripts/webhook_diagnostic.js --subscribe
 */

const dns = require('dns').promises;
const crypto = require('crypto');

const args = new Set(process.argv.slice(2));
const AUTO_SUBSCRIBE = args.has('--subscribe');

const cfg = {
  webhookUrl: process.env.WEBHOOK_URL || 'https://broker.amber.com.br/webhook',
  verifyToken: process.env.WEBHOOK_VERIFY_TOKEN || '',
  phoneNumberId: process.env.PHONE_NUMBER_ID || '123',
  metaAppSecret: process.env.META_APP_SECRET || '',
  wabaId: process.env.WABA_ID || '',
  systemUserToken: process.env.SYSTEM_USER_ACCESS_TOKEN || '',
  expectedIp: process.env.EXPECTED_IP || ''
};

const results = [];

function nowIso() {
  return new Date().toISOString();
}

function pushResult(name, status, details) {
  results.push({ name, status, details });
  const icon = status === 'PASS' ? 'OK' : status === 'FAIL' ? 'X' : '-';
  console.log(`[${icon}] ${name}: ${details}`);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function httpRequest(method, url, headers = {}, body = undefined, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      text,
      json: safeJsonParse(text),
      durationMs: Date.now() - start
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function testDnsResolution() {
  const host = new URL(cfg.webhookUrl).hostname;

  try {
    const addresses4 = await dns.resolve4(host);
    const addresses6 = await dns.resolve6(host).catch(() => []);
    const all = [...addresses4, ...addresses6];

    if (cfg.expectedIp && !all.includes(cfg.expectedIp)) {
      pushResult(
        'DNS resolution',
        'FAIL',
        `Host resolve para [${all.join(', ')}], mas EXPECTED_IP=${cfg.expectedIp}`
      );
      return;
    }

    pushResult('DNS resolution', 'PASS', `${host} -> [${all.join(', ')}]`);
  } catch (err) {
    pushResult('DNS resolution', 'FAIL', `Erro ao resolver DNS: ${err.message}`);
  }
}

async function testWebhookGetChallenge() {
  const challenge = `diag_${Date.now()}`;
  const url = new URL(cfg.webhookUrl);
  url.searchParams.set('hub.mode', 'subscribe');
  url.searchParams.set('hub.challenge', challenge);
  if (cfg.verifyToken) {
    url.searchParams.set('hub.verify_token', cfg.verifyToken);
  }

  try {
    const res = await httpRequest('GET', url.toString());
    if (res.status !== 200) {
      pushResult('GET /webhook challenge', 'FAIL', `HTTP ${res.status} | body=${res.text.slice(0, 120)}`);
      return;
    }

    if (res.text.trim() !== challenge) {
      pushResult(
        'GET /webhook challenge',
        'FAIL',
        `HTTP 200, mas challenge diferente. Esperado=${challenge}, recebido=${res.text.trim()}`
      );
      return;
    }

    pushResult('GET /webhook challenge', 'PASS', `HTTP 200 com challenge correto (${res.durationMs}ms)`);
  } catch (err) {
    pushResult('GET /webhook challenge', 'FAIL', `Erro na requisicao: ${err.message}`);
  }
}

function buildWebhookPayload() {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: {
                phone_number_id: cfg.phoneNumberId
              }
            }
          }
        ]
      }
    ]
  };
}

async function testWebhookPostUnsigned() {
  const payload = buildWebhookPayload();
  const body = JSON.stringify(payload);

  try {
    const res = await httpRequest(
      'POST',
      cfg.webhookUrl,
      {
        'content-type': 'application/json'
      },
      body
    );

    if (res.status === 403) {
      pushResult(
        'POST /webhook sem assinatura',
        'PASS',
        `HTTP 403 esperado (${res.durationMs}ms): ${res.text.slice(0, 120)}`
      );
      return;
    }

    pushResult(
      'POST /webhook sem assinatura',
      'FAIL',
      `Esperado HTTP 403, recebido HTTP ${res.status} | body=${res.text.slice(0, 120)}`
    );
  } catch (err) {
    pushResult('POST /webhook sem assinatura', 'FAIL', `Erro na requisicao: ${err.message}`);
  }
}

async function testWebhookPostSigned() {
  if (!cfg.metaAppSecret) {
    pushResult('POST /webhook com assinatura HMAC', 'SKIP', 'META_APP_SECRET nao informado');
    return;
  }

  const payload = buildWebhookPayload();
  const rawBody = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', cfg.metaAppSecret).update(rawBody, 'utf8').digest('hex');
  const signature = `sha256=${hmac}`;

  try {
    const res = await httpRequest(
      'POST',
      cfg.webhookUrl,
      {
        'content-type': 'application/json',
        'x-hub-signature-256': signature
      },
      rawBody
    );

    if (res.status === 200) {
      pushResult('POST /webhook com assinatura HMAC', 'PASS', `HTTP 200 (${res.durationMs}ms)`);
      return;
    }

    if (res.status === 403 || res.status === 500) {
      pushResult(
        'POST /webhook com assinatura HMAC',
        'FAIL',
        `HTTP ${res.status}: ${res.text.slice(0, 160)} (verifique tenant/phone_number_id/metaAppSecret)`
      );
      return;
    }

    pushResult(
      'POST /webhook com assinatura HMAC',
      'FAIL',
      `HTTP ${res.status}: ${res.text.slice(0, 160)}`
    );
  } catch (err) {
    pushResult('POST /webhook com assinatura HMAC', 'FAIL', `Erro na requisicao: ${err.message}`);
  }
}

async function getSubscribedApps() {
  const url = `https://graph.facebook.com/v23.0/${cfg.wabaId}/subscribed_apps`;
  return httpRequest('GET', url, {
    authorization: `Bearer ${cfg.systemUserToken}`
  });
}

async function testGraphSubscribedApps() {
  if (!cfg.wabaId || !cfg.systemUserToken) {
    pushResult(
      'Graph API subscribed_apps',
      'SKIP',
      'WABA_ID ou SYSTEM_USER_ACCESS_TOKEN nao informado'
    );
    return;
  }

  try {
    let res = await getSubscribedApps();

    if (res.status !== 200) {
      pushResult(
        'Graph API subscribed_apps',
        'FAIL',
        `HTTP ${res.status}: ${res.text.slice(0, 200)}`
      );
      return;
    }

    let items = Array.isArray(res.json?.data) ? res.json.data : [];

    if (items.length > 0) {
      pushResult('Graph API subscribed_apps', 'PASS', `Apps inscritos na WABA: ${items.length}`);
      return;
    }

    if (!AUTO_SUBSCRIBE) {
      pushResult(
        'Graph API subscribed_apps',
        'FAIL',
        'Nenhum app inscrito na WABA. Rode novamente com --subscribe para tentar inscrever.'
      );
      return;
    }

    const postUrl = `https://graph.facebook.com/v23.0/${cfg.wabaId}/subscribed_apps`;
    const postRes = await httpRequest('POST', postUrl, {
      authorization: `Bearer ${cfg.systemUserToken}`
    });

    if (postRes.status !== 200) {
      pushResult(
        'Graph API subscribed_apps (auto subscribe)',
        'FAIL',
        `Falha ao inscrever app. HTTP ${postRes.status}: ${postRes.text.slice(0, 200)}`
      );
      return;
    }

    res = await getSubscribedApps();
    items = Array.isArray(res.json?.data) ? res.json.data : [];

    if (res.status === 200 && items.length > 0) {
      pushResult(
        'Graph API subscribed_apps (auto subscribe)',
        'PASS',
        `Inscricao concluida. Apps agora: ${items.length}`
      );
      return;
    }

    pushResult(
      'Graph API subscribed_apps (auto subscribe)',
      'FAIL',
      `Tentou inscrever, mas lista continua vazia. HTTP ${res.status}: ${res.text.slice(0, 200)}`
    );
  } catch (err) {
    pushResult('Graph API subscribed_apps', 'FAIL', `Erro na Graph API: ${err.message}`);
  }
}

function printSummary() {
  console.log('\n=== RESUMO DO DIAGNOSTICO ===');
  console.log(`Executado em: ${nowIso()}`);
  console.log(`Webhook URL: ${cfg.webhookUrl}`);

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;

  console.log(`PASS: ${pass} | FAIL: ${fail} | SKIP: ${skip}`);

  if (fail > 0) {
    console.log('\nAcoes recomendadas:');
    console.log('1. Se GET challenge falhar: revisar DNS, SSL, Nginx e Cloud Firewall.');
    console.log('2. Se HMAC falhar: revisar metaAppSecret e phone_number_id do tenant.');
    console.log('3. Se subscribed_apps vazio: inscrever app na WABA (ou usar --subscribe).');
    process.exitCode = 1;
    return;
  }

  console.log('\nDiagnostico concluido sem falhas criticas.');
}

async function main() {
  console.log('=== WEBHOOK META DIAGNOSTIC ===');
  console.log(`URL: ${cfg.webhookUrl}`);

  await testDnsResolution();
  await testWebhookGetChallenge();
  await testWebhookPostUnsigned();
  await testWebhookPostSigned();
  await testGraphSubscribedApps();

  printSummary();
}

main().catch((err) => {
  console.error('Erro fatal no diagnostico:', err);
  process.exit(1);
});
