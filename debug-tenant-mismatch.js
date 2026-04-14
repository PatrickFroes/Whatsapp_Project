// debug-tenant-mismatch.js
// Script para debugar o mismatch entre Tenant e Configuration

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function debug() {
  console.log('\n=== DEBUG: TENANT vs CONFIGURATION ===\n');
  
  try {
    // Listar todos os tenants
    const tenants = await p.tenant.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        waPhoneId: true,
        configuration: {
          select: {
            phoneNumberId: true,
            metaAppSecret: true
          }
        }
      }
    });

    if (tenants.length === 0) {
      console.log('❌ Nenhum tenant encontrado');
      return;
    }

    console.log(`✅ Encontrados ${tenants.length} tenant(s):\n`);

    tenants.forEach((t, idx) => {
      console.log(`[${idx + 1}] Tenant: ${t.name} (${t.slug})`);
      console.log(`    Tenant.id: ${t.id}`);
      console.log(`    Tenant.waPhoneId: ${t.waPhoneId || '❌ NÃO CONFIGURADO'}`);
      
      if (t.configuration) {
        console.log(`    Configuration.phoneNumberId: ${t.configuration.phoneNumberId || '❌ NÃO CONFIGURADO'}`);
        console.log(`    Configuration.metaAppSecret: ${t.configuration.metaAppSecret ? '✅ Configurado' : '❌ NÃO CONFIGURADO'}`);
        
        if (t.waPhoneId !== t.configuration.phoneNumberId) {
          console.log(`    ⚠️  MISMATCH! waPhoneId ≠ phoneNumberId`);
          console.log(`        Esperado webhook.phone_number_id: ${t.configuration.phoneNumberId}`);
        }
      } else {
        console.log(`    ❌ Nenhuma Configuration associada`);
      }
      console.log('');
    });

    console.log('\n=== PROBLEMA IDENTIFICADO ===\n');
    console.log('O Tenant precisa ter waPhoneId = Configuration.phoneNumberId');
    console.log('Quando o webhook chega com phone_number_id, ele procura pelo Tenant.waPhoneId');
    console.log('\nSolução: Atualizar Tenant.waPhoneId com o phoneNumberId correto\n');

  } catch (e) {
    console.error('Erro:', e.message);
  } finally {
    await p.$disconnect();
  }
}

debug();
