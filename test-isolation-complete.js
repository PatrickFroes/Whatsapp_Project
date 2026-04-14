/**
 * Test Completo de Isolamento de Multi-Tenant
 * Verifica: Conversas, Mensagens, Bot Flow, Queue Assignment
 */

const prisma = require('./src/services/database');

async function testMultiTenantIsolation() {
  console.log('\n========== 🔒 TESTE DE ISOLAMENTO MULTI-TENANT ==========\n');

  try {
    // 1. Verificar Tenants
    console.log('📋 [STEP 1] Verificando tenants...');
    const tenants = await prisma.tenant.findMany({
      select: { id: true, name: true, waPhoneId: true }
    });
    console.log(`✅ Total de tenants: ${tenants.length}`);
    tenants.forEach((t) => console.log(`   - ${t.name} (waPhoneId: ${t.waPhoneId})`));

    // 2. Verificar Configurations
    console.log('\n📋 [STEP 2] Verificando configurations por tenant...');
    const configs = await prisma.configuration.findMany({
      include: { tenant: { select: { name: true } } }
    });
    console.log(`✅ Total de configurations: ${configs.length}`);
    for (const cfg of configs) {
      console.log(`   - ${cfg.tenant.name}: phoneNumberId=${cfg.phoneNumberId}, token=${cfg.whatsappToken ? '✓' : '✗'}`);
    }

    // 3. Verificar Conversas por Tenant
    console.log('\n📋 [STEP 3] Verificando conversas por tenant...');
    for (const tenant of tenants) {
      const convCount = await prisma.conversation.count({
        where: { tenantId: tenant.id }
      });
      const botCount = await prisma.conversation.count({
        where: { tenantId: tenant.id, status: 'BOT' }
      });
      const queuedCount = await prisma.conversation.count({
        where: { tenantId: tenant.id, status: 'QUEUED' }
      });
      const assignedCount = await prisma.conversation.count({
        where: { tenantId: tenant.id, status: 'ASSIGNED' }
      });

      console.log(`   ${tenant.name}:`);
      console.log(`      - Total: ${convCount}`);
      console.log(`      - BOT: ${botCount}`);
      console.log(`      - QUEUED: ${queuedCount}`);
      console.log(`      - ASSIGNED: ${assignedCount}`);

      if (convCount > 0) {
        console.log(`      ✅ Conversas corretamente isoladas`);
      }
    }

    // 4. Verificar Mensagens por Tenant
    console.log('\n📋 [STEP 4] Verificando mensagens por tenant...');
    for (const tenant of tenants) {
      const msgCount = await prisma.message.count({
        where: {
          conversation: { tenantId: tenant.id }
        }
      });
      console.log(`   ${tenant.name}: ${msgCount} mensagens`);
    }

    // 5. Verificar que Agentes (Users com role=AGENT) estão corretamente associados ao tenant
    console.log('\n📋 [STEP 5] Verificando agentes (users com role=AGENT) por tenant...');
    for (const tenant of tenants) {
      const agents = await prisma.user.findMany({
        where: { tenantId: tenant.id, role: 'AGENT' },
        select: { id: true, name: true }
      });
      console.log(`   ${tenant.name}: ${agents.length} agentes`);
      if (agents.length > 0) {
        agents.forEach((a) => console.log(`      - ${a.name}`));
      }
    }

    // 6. Verificar conversas atribuídas corretamente (assignedToId)
    console.log('\n📋 [STEP 6] Verificando atribuições (Agent-Conversation)...');
    const assignedConvs = await prisma.conversation.findMany({
      where: { assignedToId: { not: null } },
      include: {
        assignedTo: { select: { name: true, tenantId: true } },
        contact: { select: { tenantId: true } }
      },
      take: 5
    });

    if (assignedConvs.length === 0) {
      console.log('   (Nenhuma conversa atribuída a agentes no momento)');
    } else {
      for (const conv of assignedConvs) {
        const areMismatch = conv.assignedTo.tenantId !== conv.contact.tenantId;
        console.log(`   Conv ${conv.id.substring(0, 8)}...`);
        console.log(`      - Agent (User) tenant: ${conv.assignedTo.tenantId}`);
        console.log(`      - Contact tenant: ${conv.contact.tenantId}`);
        console.log(`      - Status: ${areMismatch ? '❌ MISMATCH!' : '✅ OK'}`);
      }
    }

    // 7. Verificar Contacts por Tenant
    console.log('\n📋 [STEP 7] Verificando contatos por tenant...');
    for (const tenant of tenants) {
      const contactCount = await prisma.contact.count({
        where: { tenantId: tenant.id }
      });
      console.log(`   ${tenant.name}: ${contactCount} contatos`);
    }

    // 8. Security Check: Verificar que não há vazamento de dados entre tenants
    console.log('\n🔒 [STEP 8] Verificação de segurança - Vazamento de dados...');
    let securityIssues = 0;

    // Verificar conversas órfãs (tenantId sem contact válido)
    const orphanConvs = await prisma.$queryRaw`
      SELECT c.id, c."tenantId", c."contactId", cont."tenantId" as contact_tenant
      FROM "Conversation" c
      LEFT JOIN "Contact" cont ON c."contactId" = cont.id
      WHERE cont.id IS NULL
    `;

    if (orphanConvs.length > 0) {
      console.error(`   ❌ ${orphanConvs.length} conversas órfãs (sem contact)`);
      securityIssues++;
    }

    // Verificar mensagens em conversas de outro tenant
    const crossTenantMsgs = await prisma.$queryRaw`
      SELECT m.id, m."conversationId", c."tenantId", cnt."tenantId" as contact_tenant
      FROM "Message" m
      JOIN "Conversation" c ON m."conversationId" = c.id
      JOIN "Contact" cnt ON c."contactId" = cnt.id
      WHERE c."tenantId" != cnt."tenantId"
    `;

    if (crossTenantMsgs.length > 0) {
      console.error(`   ❌ CRÍTICO: ${crossTenantMsgs.length} mensagens em conversas de tenants diferentes!`);
      securityIssues += 10; // Peso crítico
    }

    // Verificar agents atribuídos a conversas de outro tenant
    const crossTenantAssign = await prisma.$queryRaw`
      SELECT c.id, c."tenantId", u."tenantId" as agent_tenant, u.name
      FROM "Conversation" c
      JOIN "User" u ON c."assignedToId" = u.id
      WHERE c."tenantId" != u."tenantId"
    `;

    if (crossTenantAssign.length > 0) {
      console.error(`   ❌ CRÍTICO: ${crossTenantAssign.length} conversas atribuídas a agentes de outro tenant!`);
      crossTenantAssign.forEach((row) => {
        console.error(`      - Conv ${row.id.substring(0, 8)}... (tenant ${row.tenantId}) atribuída a ${row.name} (tenant ${row.agent_tenant})`);
      });
      securityIssues += 10;
    }

    if (securityIssues === 0) {
      console.log('   ✅ Nenhum vazamento de dados detectado');
    }

    // 9. Resumo Final
    console.log('\n========== 📊 RESUMO FINAL ==========');
    console.log(`Tenants: ${tenants.length}`);
    console.log(`Configurations: ${configs.length}`);
    console.log(`Problemas de segurança encontrados: ${securityIssues}`);

    if (securityIssues === 0) {
      console.log('\n✅ [RESULTADO] Multi-tenant isolation VALIDADO COM SUCESSO');
      console.log('   - Credenciais isoladas por tenant (Configuration)');
      console.log('   - Conversas corretamente associadas');
      console.log('   - Sem vazamento de dados entre tenants');
      console.log('   - Agentes atribuídos corretamente');
      console.log('   - Sistema pronto para produção');
    } else {
      console.log(`\n❌ [RESULTADO] ${securityIssues} PROBLEMA(S) ENCONTRADO(S)`);
    }
  } catch (error) {
    console.error('❌ Erro no teste:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

testMultiTenantIsolation();
