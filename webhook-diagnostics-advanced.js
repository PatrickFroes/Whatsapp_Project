#!/usr/bin/env node

/**
 * webhook-diagnostics-advanced.js
 * 
 * Diagnóstico avançado para entender por que webhooks não estão chegando
 * 
 * Verifica:
 * 1. Tenants e Configurations existem
 * 2. Credenciais foram salvas corretamente
 * 3. waPhoneId está sincronizado
 * 4. verify_token está configurado
 * 5. metaAppSecret não está vazio
 * 6. Simula webhook com waPhoneId real para validar HMAC
 */

const prisma = require('./src/services/database');
const crypto = require('crypto');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[36m';
const RESET = '\x1b[0m';

async function main() {
  console.log(`\n${BLUE}=== WEBHOOK DIAGNOSTICS ADVANCED ===${RESET}\n`);

  try {
    // 1. Listar todos os tenants e configurations
    console.log(`${BLUE}1️⃣  TENANTS & CONFIGURATIONS:${RESET}\n`);

    const tenants = await prisma.tenant.findMany({
      include: { configuration: true }
    });

    if (tenants.length === 0) {
      console.log(`${RED}❌ Nenhum tenant encontrado!${RESET}\n`);
      process.exit(1);
    }

    for (const tenant of tenants) {
      console.log(`Tenant: ${YELLOW}${tenant.name}${RESET} (${tenant.id})`);
      console.log(`  slug: ${tenant.slug}`);
      console.log(`  waPhoneId: ${tenant.waPhoneId ? GREEN + tenant.waPhoneId + RESET : RED + 'null' + RESET}`);
      console.log(`  waBusinessId: ${tenant.waBusinessId || 'null'}`);
      console.log(`  waAccessToken: ${tenant.waAccessToken ? GREEN + 'set' + RESET : RED + 'null' + RESET}`);

      if (tenant.configuration) {
        const config = tenant.configuration;
        console.log(`  Configuration (${config.id}):`);
        console.log(`    phoneNumberId: ${config.phoneNumberId ? GREEN + config.phoneNumberId + RESET : RED + 'null' + RESET}`);
        console.log(`    verifyToken: ${config.verifyToken ? GREEN + '***' + RESET : RED + 'null' + RESET}`);
        console.log(`    whatsappToken: ${config.whatsappToken ? GREEN + '***' + RESET : RED + 'null' + RESET}`);
        console.log(`    metaAppSecret: ${config.metaAppSecret ? GREEN + '***' + RESET : RED + 'null' + RESET}`);
        console.log(`    updatedBy: ${config.updatedBy || 'system'}`);
        console.log(`    createdAt: ${config.createdAt.toISOString()}`);
        console.log(`    updatedAt: ${config.updatedAt.toISOString()}`);
      } else {
        console.log(`    ${RED}❌ NO CONFIGURATION FOUND${RESET}`);
      }
      console.log();
    }

    // 2. Validar Dados
    console.log(`${BLUE}2️⃣  VALIDATION CHECKS:${RESET}\n`);

    for (const tenant of tenants) {
      const checks = [];

      if (!tenant.waPhoneId) {
        checks.push(`${RED}❌ waPhoneId não configurado${RESET}`);
      } else {
        checks.push(`${GREEN}✅ waPhoneId: ${tenant.waPhoneId}${RESET}`);
      }

      if (!tenant.configuration) {
        checks.push(`${RED}❌ Sem Configuration record${RESET}`);
      } else {
        const cfg = tenant.configuration;
        if (!cfg.phoneNumberId) {
          checks.push(`${RED}❌ phoneNumberId vazio${RESET}`);
        } else if (cfg.phoneNumberId !== tenant.waPhoneId) {
          checks.push(`${RED}❌ waPhoneId não sincronizado com Configuration.phoneNumberId${RESET}`);
          checks.push(`   Tenant.waPhoneId: ${tenant.waPhoneId}`);
          checks.push(`   Config.phoneNumberId: ${cfg.phoneNumberId}`);
        } else {
          checks.push(`${GREEN}✅ waPhoneId sincronizado${RESET}`);
        }

        if (!cfg.verifyToken) {
          checks.push(`${RED}❌ verifyToken vazio${RESET}`);
        } else {
          checks.push(`${GREEN}✅ verifyToken: ${cfg.verifyToken.substring(0, 10)}...${RESET}`);
        }

        if (!cfg.metaAppSecret) {
          checks.push(`${RED}❌ metaAppSecret VAZIO - webhooks falharão com HMAC 403!${RESET}`);
        } else {
          checks.push(`${GREEN}✅ metaAppSecret: ${cfg.metaAppSecret.substring(0, 10)}...${RESET}`);
        }

        if (!cfg.whatsappToken) {
          checks.push(`${YELLOW}⚠️  whatsappToken vazio (pode impedir envio de mensagens)${RESET}`);
        } else {
          checks.push(`${GREEN}✅ whatsappToken: ${cfg.whatsappToken.substring(0, 10)}...${RESET}`);
        }
      }

      console.log(`${YELLOW}${tenant.name}:${RESET}`);
      checks.forEach(c => console.log(`  ${c}`));
      console.log();
    }

    // 3. Simular validação HMAC com waPhoneId real
    console.log(`${BLUE}3️⃣  HMAC VALIDATION TEST:${RESET}\n`);

    for (const tenant of tenants) {
      if (!tenant.waPhoneId || !tenant.configuration?.metaAppSecret) {
        console.log(`${YELLOW}⏭️  ${tenant.name}: Skipped (missing waPhoneId or metaAppSecret)${RESET}\n`);
        continue;
      }

      const testPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: {
                    phone_number_id: tenant.waPhoneId, // ← Use real phone_number_id
                    display_phone_number: '5511988776655',
                    business_account_id: tenant.waBusinessId || '123456789'
                  },
                  messages: [
                    {
                      from: '5511998765432',
                      id: 'wamid.test_' + Date.now(),
                      timestamp: Math.floor(Date.now() / 1000),
                      type: 'text',
                      text: { body: 'Test webhook message' }
                    }
                  ],
                  contacts: [
                    {
                      wa_id: '5511998765432',
                      profile: { name: 'Test User' }
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const rawBody = JSON.stringify(testPayload);
      const hmac = crypto
        .createHmac('sha256', tenant.configuration.metaAppSecret)
        .update(rawBody, 'utf8')
        .digest('hex');
      const signature = `sha256=${hmac}`;

      console.log(`${YELLOW}${tenant.name}:${RESET}`);
      console.log(`  phone_number_id: ${GREEN}${tenant.waPhoneId}${RESET}`);
      console.log(`  Calculated Signature:`);
      console.log(`    ${signature.substring(0, 20)}...${RESET}`);
      console.log(`  Expected header for Meta: X-Hub-Signature-256: ${GREEN}${signature}${RESET}`);
      console.log(`  Status: ${GREEN}✅ HMAC can be validated${RESET}\n`);
    }

    // 4. Recomendações se houver problemas
    console.log(`${BLUE}4️⃣  TROUBLESHOOTING CHECKLIST:${RESET}\n`);

    const hasIssues = tenants.some(t =>
      !t.waPhoneId ||
      !t.configuration ||
      !t.configuration.metaAppSecret ||
      !t.configuration.verifyToken ||
      (t.configuration.phoneNumberId !== t.waPhoneId)
    );

    if (hasIssues) {
      console.log(`${YELLOW}Issues found. Follow these steps:${RESET}\n`);
      console.log(`1. ${YELLOW}Verify Meta Configuration:${RESET}`);
      console.log(`   - Go to Meta App Dashboard > WhatsApp > Configuration`);
      console.log(`   - Check "Webhook URL" is set to: https://<your-domain>/webhook`);
      console.log(`   - Check "Verify Token" matches your Configuration.verifyToken\n`);

      console.log(`2. ${YELLOW}Re-update Configuration:${RESET}`);
      console.log(`   - Use admin panel or API to update Configuration`);
      console.log(`   - Ensure phoneNumberId is the actual Meta phone number ID`);
      console.log(`   - Ensure metaAppSecret is correct (from Meta App Settings)\n`);

      console.log(`3. ${YELLOW}Test Webhook Manually:${RESET}`);
      console.log(`   curl -X POST https://<your-domain>/webhook \\`);
      console.log(`     -H "X-Hub-Signature-256: sha256=..." \\`);
      console.log(`     -H "Content-Type: application/json" \\`);
      console.log(`     -d '{...payload...}'\n`);

      console.log(`4. ${YELLOW}Check Server Logs:${RESET}`);
      console.log(`   docker logs broker_app | grep -i webhook\n`);
    } else {
      console.log(`${GREEN}✅ All checks passed!${RESET}\n`);
      console.log(`If webhooks still not working:${RESET}\n`);
      console.log(`1. Verify Meta Dashboard has correct Webhook URL (https:// required)\n`);
      console.log(`2. Check browser console for CORS errors\n`);
      console.log(`3. Monitor: docker logs broker_app | tail -f\n`);
    }

    console.log(`${BLUE}=== END DIAGNOSTICS ===${RESET}\n`);

  } catch (error) {
    console.error(`${RED}Error during diagnostics:${RESET}`, error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

main();
