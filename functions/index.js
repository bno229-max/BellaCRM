const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
admin.initializeApp();

// Dispara automaticamente sempre que o painel do salão cria uma notificação
// para um cliente (confirmar, cancelar, encerrar atendimento, lembrete).
// É essa função que efetivamente ENVIA o push pro celular do cliente —
// isso não pode ser feito só pelo navegador, por segurança do Firebase.
exports.sendClientPush = onDocumentCreated('clientNotifications/{notifId}', async (event) => {
  const data = event.data.data();
  console.log('sendClientPush disparada para notificação', event.params.notifId, JSON.stringify(data));
  if (!data || !data.clientId || !data.text) {
    console.warn('Notificação sem clientId ou text — ignorando.');
    return;
  }

  const clientRef = admin.firestore().collection('clients').doc(data.clientId);
  const clientDoc = await clientRef.get();
  if (!clientDoc.exists) {
    console.warn('Cliente', data.clientId, 'não encontrado — ignorando.');
    return;
  }

  const fcmToken = clientDoc.data().fcmToken;
  if (!fcmToken) {
    console.log('Cliente', data.clientId, 'ainda não ativou notificações push (sem fcmToken) — pulando envio.');
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
  } catch (err) {
    console.error('Erro ao enviar push para', data.clientId, ':', err.code, err.message);
    // token inválido/expirado (ex: cliente desinstalou o app) — remove pra não tentar de novo
    if (err.code === 'messaging/registration-token-not-registered') {
      await clientRef.update({ fcmToken: admin.firestore.FieldValue.delete() });
      console.log('Token inválido removido do cliente', data.clientId);
    }
  }
});
