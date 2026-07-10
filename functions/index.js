const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
admin.initializeApp();

// Dispara automaticamente sempre que o painel do salão cria uma notificação
// para um cliente (confirmar, cancelar, encerrar atendimento, lembrete).
// É essa função que efetivamente ENVIA o push pro celular do cliente —
// isso não pode ser feito só pelo navegador, por segurança do Firebase.
exports.sendClientPush = onDocumentCreated('clientNotifications/{notifId}', async (event) => {
  const data = event.data.data();
  if (!data || !data.clientId || !data.text) return;

  const clientRef = admin.firestore().collection('clients').doc(data.clientId);
  const clientDoc = await clientRef.get();
  if (!clientDoc.exists) return;

  const fcmToken = clientDoc.data().fcmToken;
  if (!fcmToken) {
    console.log('Cliente', data.clientId, 'ainda não ativou notificações push — pulando envio.');
    return;
  }

  const message = {
    token: fcmToken,
    notification: {
      title: 'Studio Jardins',
      body: data.text,
    },
    webpush: {
      fcmOptions: { link: '/cliente/' },
      notification: { icon: '/cliente/icons/icon-192.png' },
    },
  };

  try {
    await admin.messaging().send(message);
    console.log('Push enviado com sucesso para', data.clientId);
  } catch (err) {
    console.error('Erro ao enviar push:', err);
    // token inválido/expirado (ex: cliente desinstalou o app) — remove pra não tentar de novo
    if (err.code === 'messaging/registration-token-not-registered') {
      await clientRef.update({ fcmToken: admin.firestore.FieldValue.delete() });
    }
  }
});
