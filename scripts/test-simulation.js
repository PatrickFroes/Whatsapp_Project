const axios = require('axios');

async function testWebhook() {
  console.log('--- TESTE SIMULADO INICIADO ---');
  try {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '5511999999999',
                    type: 'text',
                    text: { body: 'Oi' }
                  }
                ],
                contacts: [
                  {
                    profile: { name: 'Teste Local' }
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    console.log('Enviando POST para http://127.0.0.1:3001/webhook...');

    const res = await axios.post('http://127.0.0.1:3001/webhook', payload);
    console.log('RESPOSTA DO SERVIDOR:', res.status, res.statusText);

    if (res.status === 200) {
      console.log('SUCESSO: O servidor aceitou o webhook.');
    }
  } catch (e) {
    console.error('ERRO NA CONEXÃO:', e.cause || e.message || e);
  }
}

testWebhook();
