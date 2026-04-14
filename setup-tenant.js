#!/usr/bin/env node
/**
 * Script para criar um Tenant e Configuration
 * USE: node setup-tenant.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function setup() {
  console.log('🔧 Iniciando configuração de Tenant...\n');

  try {
    // 1. Criar ou buscar tenant
    let tenant = await prisma.tenant.findUnique({
      where: { slug: 'amber' }
    });

    if (!tenant) {
      console.log('📝 Criando novo Tenant...');
      tenant = await prisma.tenant.create({
        data: {
          name: 'Amber',
          slug: 'amber',
          plan: 'enterprise',
          active: true,
          waPhoneId: process.env.PHONE_NUMBER_ID || '958814803984993',
          waBusinessId: 'seu-business-id-aqui',
          waAccessToken: process.env.WHATSAPP_TOKEN || 'seu-token-aqui'
        }
      });
      console.log(`✅ Tenant criado: ${tenant.id}`);
    } else {
      console.log(`✅ Tenant existente: ${tenant.id} (${tenant.name})`);
    }

    // 2. Criar ou atualizar Configuration
    const config = await prisma.configuration.upsert({
      where: { tenantId: tenant.id },
      update: {
        phoneNumberId: process.env.PHONE_NUMBER_ID || '958814803984993',
        verifyToken: process.env.VERIFY_TOKEN || 'minha_senha_segura_webhook',
        metaAppSecret: process.env.META_APP_SECRET || 'seu-meta-app-secret',
        whatsappToken: process.env.WHATSAPP_TOKEN || 'seu-whatsapp-token',
        updatedBy: 'system',
        updatedAt: new Date()
      },
      create: {
        tenantId: tenant.id,
        phoneNumberId: process.env.PHONE_NUMBER_ID || '958814803984993',
        verifyToken: process.env.VERIFY_TOKEN || 'minha_senha_segura_webhook',
        metaAppSecret: process.env.META_APP_SECRET || 'seu-meta-app-secret',
        whatsappToken: process.env.WHATSAPP_TOKEN || 'seu-whatsapp-token',
        updatedBy: 'system'
      }
    });

    console.log(`✅ Configuration criada para tenant ${tenant.id}\n`);

    // 3. Exibir resumo
    console.log('📋 RESUMO DA CONFIGURAÇÃO:');
    console.log(`   Tenant ID:        ${tenant.id}`);
    console.log(`   Tenant Name:      ${tenant.name}`);
    console.log(`   Phone Number ID:  ${config.phoneNumberId}`);
    console.log(`   Verify Token:     ${config.verifyToken ? '✅ Configurado' : '❌ Faltando'}`);
    console.log(`   Meta App Secret:  ${config.metaAppSecret ? '✅ Configurado' : '❌ Faltando'}`);
    console.log(`   WhatsApp Token:   ${config.whatsappToken ? '✅ Configurado' : '❌ Faltando'}`);

    console.log('\n⚠️ IMPORTANTE:');
    console.log('   - Configure o whatsappToken correto em: https://developers.facebook.com');
    console.log('   - Configure o metaAppSecret correto em: App Settings → Basic');
    console.log('   - Use a URL: https://broker.amber.com.br/webhook');
    console.log('   - Use o Verify Token: ' + (config.verifyToken || 'minha_senha_segura_webhook'));

  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

setup();
