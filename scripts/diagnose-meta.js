const axios = require('axios');
const prisma = require('../src/services/database');

async function run() {
  console.log('🔍 INICIANDO DIAGNÓSTICO DA API DO META (GRAPH API)...');

  try {
    // 1. Buscar configurações do banco
    const configs = await prisma.configuration.findMany({
      include: { tenant: true }
    });

    if (configs.length === 0) {
      console.log('❌ Nenhuma configuração de tenant encontrada no banco.');
      process.exit(0);
    }

    console.log(`\n📊 Encontrado(s) ${configs.length} tenant(s) no banco.`);

    for (const config of configs) {
      const { tenant, phoneNumberId, verifyToken, whatsappToken, metaAppSecret } = config;
      console.log('\n========================================================================');
      console.log(`🏢 Tenant: ${tenant.name} (${tenant.slug})`);
      console.log(`📞 Phone Number ID: ${phoneNumberId}`);
      console.log(`🔑 Verify Token: ${verifyToken}`);
      console.log(`📝 Meta App Secret (mascarado): ${metaAppSecret ? 'DEFINIDO ✓' : 'NÃO CONFIGURADO ❌'}`);
      console.log(`📝 Access Token (mascarado): ${whatsappToken ? `${whatsappToken.substring(0, 15)}...` : 'NÃO CONFIGURADO ❌'}`);

      if (!whatsappToken) {
        console.log('⚠️ Ignorando chamadas à API pois o token do WhatsApp está ausente.');
        continue;
      }

      const headers = {
        Authorization: `Bearer ${whatsappToken}`
      };

      let wabaId = null;

      // Passo A: Consultar Status do Telefone na API do Meta
      console.log('\n📡 A. Consultando informações do número na Graph API...');
      try {
        const phoneResponse = await axios.get(
          `https://graph.facebook.com/v19.0/${phoneNumberId}`,
          { headers }
        );
        console.log('✅ Sucesso! Resposta da API:');
        console.log(JSON.stringify(phoneResponse.data, null, 2));
      } catch (err) {
        console.log('❌ Falha ao buscar detalhes do telefone:');
        if (err.response) {
          console.log(`   Status: HTTP ${err.response.status}`);
          console.log('   Detalhes:', JSON.stringify(err.response.data, null, 2));
        } else {
          console.log('   Erro:', err.message);
        }
      }

      // Passo A.2: Descobrir a WABA ID
      console.log('\n📡 A.2. Descobrindo a WABA ID associada ao número...');
      
      // Verificar se a WABA ID foi passada via argumento (--waba <id>)
      const wabaArgIndex = process.argv.indexOf('--waba');
      if (wabaArgIndex !== -1 && process.argv[wabaArgIndex + 1]) {
        wabaId = process.argv[wabaArgIndex + 1];
        console.log(`👉 Usando WABA ID fornecida manualmente: ${wabaId}`);
      } else {
        try {
          // 1. Obter empresas (businesses) associadas ao token
          const businessesResponse = await axios.get(
            'https://graph.facebook.com/v19.0/me/businesses',
            { headers }
          );
          
          const businesses = businessesResponse.data?.data || [];
          console.log(`ℹ️ Encontrada(s) ${businesses.length} empresa(s) associada(s) ao token.`);

          for (const business of businesses) {
            console.log(`   - Verificando empresa: ${business.name} (ID: ${business.id})...`);
            
            try {
              // 2. Buscar WABAs pertencentes a essa empresa
              const wabaResponse = await axios.get(
                `https://graph.facebook.com/v19.0/${business.id}/whatsapp_business_accounts`,
                { headers }
              );
              
              const accounts = wabaResponse.data?.data || [];
              console.log(`     ℹ️ Encontrada(s) ${accounts.length} WABA(s) nesta empresa.`);

              for (const account of accounts) {
                console.log(`       - Verificando WABA: ${account.name} (ID: ${account.id})...`);
                
                try {
                  // 3. Buscar números de telefone dessa WABA
                  const numbersResponse = await axios.get(
                    `https://graph.facebook.com/v19.0/${account.id}/phone_numbers`,
                    { headers }
                  );
                  
                  const numbers = numbersResponse.data?.data || [];
                  const hasMatchingNumber = numbers.some(n => n.id === phoneNumberId);
                  
                  if (hasMatchingNumber) {
                    wabaId = account.id;
                    console.log(`🎉 WABA ID Encontrada e Confirmada: ${wabaId}`);
                    break;
                  }
                } catch (numErr) {
                  console.log(`         ⚠️ Erro ao listar números para a WABA ${account.id}:`, numErr.message);
                }
              }
              
              if (wabaId) break;
            } catch (wabaErr) {
              console.log(`     ⚠️ Erro ao buscar WABAs para a empresa ${business.id}:`, wabaErr.message);
            }
          }
        } catch (err) {
          console.log('❌ Falha ao descobrir WABA ID através do token:');
          if (err.response) {
            console.log(`   Status: HTTP ${err.response.status}`);
            console.log('   Detalhes:', JSON.stringify(err.response.data, null, 2));
          } else {
            console.log('   Erro:', err.message);
          }
          console.log('\n💡 DICA: Como a API negou permissão para listar empresas, você pode passar a WABA ID manualmente:');
          console.log('   sudo docker exec -it broker_app node scripts/diagnose-meta.js --waba SUA_WABA_ID');
        }
      }

      if (!wabaId) {
        console.log('❌ Não foi possível identificar a WABA ID correspondente a este número.');
        continue;
      }

      // Passo B: Consultar aplicativos inscritos no webhook da WABA (subscribed_apps)
      console.log(`\n📡 B. Verificando aplicativos inscritos na WABA (${wabaId})...`);
      try {
        const subResponse = await axios.get(`https://graph.facebook.com/v19.0/${wabaId}/subscribed_apps`, { headers });
        console.log('✅ Sucesso! Resposta da API:');
        console.log(JSON.stringify(subResponse.data, null, 2));
        
        const isSubscribed = subResponse.data?.data?.length > 0;
        if (isSubscribed) {
          console.log('🎉 O aplicativo está inscrito no webhook desta WABA.');
        } else {
          console.log('⚠️ AVISO: O aplicativo NÃO está inscrito na API de Webhooks para esta WABA!');
          console.log('👉 Isso explica porque os webhooks de mensagens não chegam no servidor.');
          console.log('💡 DICA: Podemos tentar forçar a inscrição agora mesmo pela Graph API.');
        }
      } catch (err) {
        console.log('❌ Falha ao verificar inscrições de webhooks:');
        if (err.response) {
          console.log(`   Status: HTTP ${err.response.status}`);
          console.log('   Detalhes:', JSON.stringify(err.response.data, null, 2));
        } else {
          console.log('   Erro:', err.message);
        }
      }

      // Passo C: Permitir forçar a inscrição se solicitado
      if (process.argv.includes('--subscribe')) {
        console.log(`\n🚀 C. Enviando requisição para FORÇAR inscrição de webhooks na WABA (${wabaId})...`);
        try {
          const subscribeResponse = await axios.post(
            `https://graph.facebook.com/v19.0/${wabaId}/subscribed_apps`,
            {},
            { headers }
          );
          console.log('✅ Sucesso ao inscrever o aplicativo!');
          console.log(JSON.stringify(subscribeResponse.data, null, 2));
        } catch (err) {
          console.log('❌ Falha ao realizar a inscrição:');
          if (err.response) {
            console.log(`   Status: HTTP ${err.response.status}`);
            console.log('   Detalhes:', JSON.stringify(err.response.data, null, 2));
          } else {
            console.log('   Erro:', err.message);
          }
        }
      } else {
        console.log('\n💡 DICA: Para forçar a inscrição automática via API, execute este script com a flag "--subscribe":');
        console.log(`   sudo docker exec -it broker_app node scripts/diagnose-meta.js --subscribe`);
      }
    }
  } catch (globalError) {
    console.error('❌ Erro inesperado na execução do diagnóstico:', globalError);
  } finally {
    await prisma.$disconnect();
    console.log('\n🔚 Diagnóstico concluído.');
  }
}

run();
