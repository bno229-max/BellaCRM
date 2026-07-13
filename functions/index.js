const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
admin.initializeApp();

// Dispara automaticamente sempre que o painel do salão cria uma notificação
// para um cliente (confirmar, cancelar, encerrar atendimento, lembrete).
// É essa função que efetivamente ENVIA o push pro celular do cliente —
// isso não pode ser feito só pelo navegador, por segurança do Firebase.
exports.sendClientPush = onDocumentCreated('clientNotifications/{notifId}', async (event) => {
  const data = event.data.data();
  const notifRef = event.data.ref;
  console.log('sendClientPush disparada para notificação', event.params.notifId, JSON.stringify(data));
  if (!data || !data.clientId || !data.text) {
    console.warn('Notificação sem clientId ou text — ignorando.');
    await notifRef.update({ pushStatus: 'error', pushError: 'Notificação sem clientId ou text' }).catch(() => {});
    return;
  }

  const clientRef = admin.firestore().collection('clients').doc(data.clientId);
  const clientDoc = await clientRef.get();
  if (!clientDoc.exists) {
    console.warn('Cliente', data.clientId, 'não encontrado — ignorando.');
    await notifRef.update({ pushStatus: 'error', pushError: 'Cliente não encontrado' }).catch(() => {});
    return;
  }

  const fcmToken = clientDoc.data().fcmToken;
  if (!fcmToken) {
    console.log('Cliente', data.clientId, 'ainda não ativou notificações push (sem fcmToken) — pulando envio.');
    await notifRef.update({ pushStatus: 'no_token' }).catch(() => {});
    return;
  }

  let salonName = 'Studio Jardins';
  try {
    const cfgDoc = await admin.firestore().collection('config').doc('business').get();
    if (cfgDoc.exists && cfgDoc.data().salon && cfgDoc.data().salon.nome) {
      salonName = cfgDoc.data().salon.nome;
    }
  } catch (e) { /* usa o nome padrão se não conseguir buscar */ }

  const message = {
    token: fcmToken,
    notification: {
      title: salonName,
      body: data.text,
    },
    webpush: {
      fcmOptions: { link: '/cliente/' },
      notification: { icon: '/cliente/icons/icon-192.png' },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('Push enviado com sucesso para', data.clientId, '· messageId:', response);
    await notifRef.update({ pushStatus: 'sent', pushMessageId: response }).catch(() => {});
  } catch (err) {
    console.error('Erro ao enviar push para', data.clientId, ':', err.code, err.message);
    await notifRef.update({ pushStatus: 'error', pushError: (err.code || '') + ' ' + (err.message || '') }).catch(() => {});
    // token inválido/expirado (ex: cliente desinstalou o app) — remove pra não tentar de novo
    if (err.code === 'messaging/registration-token-not-registered') {
      await clientRef.update({ fcmToken: admin.firestore.FieldValue.delete() });
      console.log('Token inválido removido do cliente', data.clientId);
    }
  }
});

// Roda automaticamente à meia-noite do dia 1º de cada mês (horário de São Paulo):
// zera o saldo de cashback de todos os clientes, já que o cashback só vale até o
// início do mês seguinte a quando foi ganho. Isso é o que garante a expiração
// funcionar sozinha, mesmo que ninguém abra o app do salão naquele dia.
exports.expireCashbackMonthly = onSchedule(
  { schedule: '0 0 1 * *', timeZone: 'America/Sao_Paulo' },
  async () => {
    const snap = await admin.firestore().collection('clients').get();
    const batches = [];
    let batch = admin.firestore().batch();
    let opsInBatch = 0;
    let totalExpirados = 0;

    snap.forEach(doc => {
      const cashback = doc.data().cashback || 0;
      if (cashback > 0) {
        batch.update(doc.ref, { cashback: 0, cashbackExpiradoEm: admin.firestore.FieldValue.serverTimestamp() });
        opsInBatch++;
        totalExpirados++;
        if (opsInBatch >= 400) { // limite de segurança bem abaixo do máximo de 500 por batch
          batches.push(batch.commit());
          batch = admin.firestore().batch();
          opsInBatch = 0;
        }
      }
    });
    if (opsInBatch > 0) batches.push(batch.commit());

    await Promise.all(batches);
    console.log('Cashback mensal expirado para', totalExpirados, 'cliente(s).');
  }
);
