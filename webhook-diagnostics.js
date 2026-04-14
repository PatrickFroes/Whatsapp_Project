#!/bin/bash

###############################################################################
# webhook-diagnostics.sh - Diagnóstico de Webhooks Multi-tenant no Linux
#
# Uso: docker exec broker_app node webhook-diagnostics.js
###############################################################################

const prisma = require('./src/services/database');

async function diagnoseWebhooks() {
  console.log(
    '\n╔════════════════════════════════════════════════════════════════╗'
  );
  console.log(
    '║         WEBHOOK DIAGNOSTIC - Multi-tenant Configuration        ║'
  );
  console.log(
    '╚════════════════════════════════════════════════════════════════╝\n'
  );

  try {
    // 1. List all tenants with their configuration
    console.log('📊 [1] ALL TENANTS & CONFIGURATIONS:\n');

    const tenants = await prisma.tenant.findMany({
      include: {
        configuration: true
      }
    });

    if (tenants.length === 0) {
      console.log('   ⚠️  NO TENANTS FOUND\n');
      return;
    }

    tenants.forEach((tenant, idx) => {
      console.log(`   Tenant #${idx + 1}: ${tenant.name}`);
      console.log(`   ├─ ID: ${tenant.id}`);
      console.log(`   ├─ Slug: ${tenant.slug}`);
      console.log(`   ├─ waPhoneId: ${tenant.waPhoneId || '❌ MISSING'}`);

      if (tenant.configuration) {
        const config = tenant.configuration;
        const hasPhoneId = !!config.phoneNumberId;
        const hasToken = !!config.verifyToken;
        const hasWhatsapp = !!config.whatsappToken;
        const hasSecret = !!config.metaAppSecret;
        const isComplete = hasPhoneId && hasToken && hasWhatsapp && hasSecret;

        console.log(`   ├─ Configuration Status:`);
        console.log(
          `   │  ├─ phoneNumberId: ${hasPhoneId ? '✅' : '❌'} ${hasPhoneId ? config.phoneNumberId : 'MISSING'}`
        );
        console.log(`   │  ├─ verifyToken: ${hasToken ? '✅' : '❌'} ${hasToken ? '***' : 'MISSING'}`);
        console.log(`   │  ├─ whatsappToken: ${hasWhatsapp ? '✅' : '❌'} ${hasWhatsapp ? '***' : 'MISSING'}`);
        console.log(`   │  └─ metaAppSecret: ${hasSecret ? '✅' : '❌'} ${hasSecret ? '***' : 'MISSING'}`);
        console.log(`   └─ Overall: ${isComplete ? '🟢 READY' : '🔴 INCOMPLETE'}\n`);
      } else {
        console.log(`   └─ ❌ NO CONFIGURATION RECORD (MUST BE CREATED)\n`);
      }
    });

    // 2. Validate webhook routing
    console.log('📍 [2] WEBHOOK ROUTING VALIDATION:\n');

    const configsWithPhone = tenants.filter(
      (t) => t.configuration?.phoneNumberId && t.waPhoneId
    );

    if (configsWithPhone.length === 0) {
      console.log('   ⚠️  NO TENANTS READY TO RECEIVE WEBHOOKS\n');
    } else {
      console.log(`   ${configsWithPhone.length}/${tenants.length} tenants ready:\n`);
      configsWithPhone.forEach((tenant) => {
        console.log(`   ✅ ${tenant.name}`);
        console.log(`      Phone ID: ${tenant.waPhoneId}`);
        console.log(`      Routes via: Configuration.metaAppSecret hash validation\n`);
      });
    }

    // 3. Check for mismatches
    console.log('⚠️  [3] DATA INTEGRITY CHECKS:\n');

    const mismatches = tenants.filter((t) => {
      if (!t.configuration || !t.waPhoneId) return false;
      return t.waPhoneId !== t.configuration.phoneNumberId;
    });

    if (mismatches.length === 0) {
      console.log('   ✅ No mismatches found between Tenant.waPhoneId and Configuration.phoneNumberId\n');
    } else {
      console.log(`   ⚠️  FOUND ${mismatches.length} MISMATCHES:\n`);
      mismatches.forEach((tenant) => {
        console.log(`   ${tenant.name}:`);
        console.log(`      Tenant.waPhoneId:           ${tenant.waPhoneId}`);
        console.log(`      Configuration.phoneNumberId: ${tenant.configuration.phoneNumberId}\n`);
      });

      console.log('   FIX: Run ConfigurationController.saveConfiguration() to resync\n');
    }

    // 4. Next steps
    console.log('📋 [4] NEXT STEPS IF WEBHOOKS NOT ARRIVING:\n');

    const incomplete = tenants.filter((t) => {
      const cfg = t.configuration;
      return !cfg || !cfg.phoneNumberId || !cfg.verifyToken || !cfg.whatsappToken || !cfg.metaAppSecret;
    });

    if (incomplete.length > 0) {
      console.log(`   ⚠️  ${incomplete.length} tenant(s) need configuration:\n`);
      console.log('   1. Login to admin panel for each tenant');
      console.log('   2. Go to Settings → Configuration');
      console.log('   3. Enter:');
      console.log('      - Phone Number ID (from Meta Dashboard)');
      console.log('      - Verify Token (create one, same on Meta)');
      console.log('      - WhatsApp Token (from Meta)');
      console.log('      - Meta App Secret (from Meta Settings)');
      console.log('   4. Click Save');
      console.log('   5. Webhooks will route correctly\n');
    } else {
      console.log('   ✅ All configurations complete!');
      console.log(
        '   Check nginx logs: docker logs broker_nginx | tail -50\n'
      );
      console.log('   Check app logs: docker logs broker_app | grep Webhook\n');
    }
  } catch (error) {
    console.error('❌ Error:', error.message, '\n');
  } finally {
    await prisma.$disconnect();
  }
}

diagnoseWebhooks();
