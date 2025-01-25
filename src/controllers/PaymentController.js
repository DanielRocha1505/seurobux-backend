const db = require('../config/database');
const pixupConfig = require('../config/pixup');
const QRCode = require('qrcode');

class PaymentController {
  async createPayment(req, res) {
    try {
      const { amount, items, email, customer } = req.body;

      if (!amount || !items || !email || !customer) {
        return res.status(400).json({ 
          statusCode: 400,
          message: 'Dados inválidos'
        });
      }

      const paymentData = {
        amount: parseFloat(amount).toFixed(2),
        external_id: `PAY-${Date.now()}`,
        payer: {
          name: customer.name,
          document: customer.document.replace(/\D/g, ''),
          email: email
        },
        postbackUrl: `${process.env.NGROK_URL}/api/payments/webhook`,
        payerQuestion: 'Pagamento Galaxy Store',
        expiration: 300, 
      };

      console.log('Dados do pagamento:', paymentData);

      const paymentResponse = await pixupConfig.makeRequest('/pix/qrcode', 'POST', paymentData);
      console.log('Resposta QR Code:', paymentResponse);

      const qrcodeImage = await QRCode.toDataURL(paymentResponse.qrcode);

      const connection = await db.getConnection();
      await connection.beginTransaction();

      try {
        const [result] = await connection.query(
          `INSERT INTO payments (
            external_id, 
            amount, 
            status, 
            pix_code,
            customer_email,
            reference,
            expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
          [
            paymentData.external_id,
            amount,
            'pending',
            paymentResponse.qrcode,
            email,
            paymentData.external_id
          ]
        );

        const payment_id = result.insertId;

        for (const item of items) {
          const [stockItem] = await connection.query(
            `SELECT id FROM stock_items 
             WHERE product_id = ? AND status = 'AVAILABLE' 
             LIMIT 1 FOR UPDATE`,
            [item.id]
          );

          if (!stockItem.length) {
            throw new Error(`Item ${item.id} não disponível`);
          }

          await connection.query(
            `UPDATE stock_items 
             SET payment_id = ?, 
                 reserved_at = NOW()
             WHERE id = ?`,
            [payment_id, stockItem[0].id]
          );
        }

        await connection.commit();

        res.json({
          payment_id,
          qrcode: paymentResponse.qrcode,
          qrcode_image: qrcodeImage,
          external_id: paymentData.external_id,
          expires_in: 300, 
          status: 'pending'
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Erro completo:', error);
      res.status(500).json({ 
        statusCode: 500,
        message: error.response?.data?.message || 'Erro ao processar pagamento'
      });
    }
  }

  async handleWebhook(req, res) {
    try {
      console.log('Webhook recebido:', req.body);
      
      const { requestBody } = req.body;
      const { 
        transactionType,
        transactionId,
        external_id,
        status,
        dateApproval,
        creditParty
      } = requestBody;

      if (transactionType !== 'RECEIVEPIX') {
        return res.json({ success: true });
      }

      const connection = await db.getConnection();
      await connection.beginTransaction();

      try {
        const [payment] = await connection.query(
          'SELECT id, status FROM payments WHERE external_id = ?',
          [external_id]
        );

        if (!payment.length) {
          console.error('Pagamento não encontrado:', external_id);
          return res.status(404).json({ 
            statusCode: 404,
            message: 'Pagamento não encontrado'
          });
        }

        if (payment[0].status === 'completed') {
          return res.json({ success: true });
        }

        if (status === 'PAID') {
          console.log('Processando pagamento confirmado:', external_id);

          await connection.query(
            `UPDATE payments 
             SET status = 'completed',
                 transaction_id = ?,
                 completed_at = ?,
                 payer_email = ?
             WHERE id = ?`,
            [transactionId, dateApproval, creditParty.email, payment[0].id]
          );

          await connection.query(
            `UPDATE stock_items 
             SET status = 'SOLD',
                 sold_at = ?,
                 sold_to = ?
             WHERE payment_id = ? AND status = 'AVAILABLE'`,
            [dateApproval, creditParty.email, payment[0].id]
          );

          console.log('Pagamento processado com sucesso');
        }

        await connection.commit();
        res.json({ success: true });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Erro no webhook:', error);
      res.status(500).json({ 
        statusCode: 500,
        message: error.message 
      });
    }
  }

  async getPaymentStatus(req, res) {
    try {
      const { payment_id } = req.params;

      const [payment] = await db.query(
        `SELECT 
          p.status,
          p.external_id,
          p.completed_at,
          GROUP_CONCAT(s.code) as item_codes
         FROM payments p
         LEFT JOIN stock_items s ON s.payment_id = p.id AND s.status = 'SOLD'
         WHERE p.id = ?
         GROUP BY p.id`,
        [payment_id]
      );

      if (!payment.length) {
        return res.status(404).json({ 
          statusCode: 404,
          message: 'Pagamento não encontrado'
        });
      }

      if (payment[0].status === 'completed') {
        const itemCodes = payment[0].item_codes ? payment[0].item_codes.split(',') : [];
        return res.json({
          status: 'completed',
          items: itemCodes,
          paid_at: payment[0].completed_at,
          message: 'Pagamento confirmado! Seus códigos estão disponíveis abaixo.'
        });
      }

      res.json({ 
        status: payment[0].status,
        message: 'Aguardando confirmação do pagamento...'
      });

    } catch (error) {
      console.error('Erro ao verificar status:', error);
      res.status(500).json({ 
        statusCode: 500,
        message: 'Erro ao verificar status do pagamento'
      });
    }
  }

  async checkPaymentStatus() {
    try {
      const [pendingPayments] = await db.query(
        `SELECT id, external_id 
         FROM payments 
         WHERE status = 'pending' 
         AND expires_at > NOW()`,
      );

      for (const payment of pendingPayments) {
        try {
          const pixupStatus = await pixupConfig.makeRequest(
            `/pix/qrcode/${payment.external_id}/status`,
            'GET'
          );

          console.log(`Status Pixup para ${payment.external_id}:`, pixupStatus);

          if (pixupStatus.status === 'PAID' || pixupStatus.statusId === 1) {
            const connection = await db.getConnection();
            await connection.beginTransaction();

            try {
              await connection.query(
                `UPDATE payments 
                 SET status = 'completed',
                     transaction_id = ?,
                     completed_at = NOW()
                 WHERE id = ?`,
                [pixupStatus.transactionId || pixupStatus.id, payment.id]
              );

              await connection.query(
                `UPDATE stock_items 
                 SET status = 'SOLD',
                     sold_at = NOW()
                 WHERE payment_id = ? AND status = 'AVAILABLE'`,
                [payment.id]
              );

              await connection.commit();
              console.log(`Pagamento ${payment.external_id} confirmado e processado`);
            } catch (error) {
              await connection.rollback();
              throw error;
            } finally {
              connection.release();
            }
          }
        } catch (error) {
          console.error(`Erro ao verificar pagamento ${payment.external_id}:`, error);
        }
      }
    } catch (error) {
      console.error('Erro ao verificar pagamentos pendentes:', error);
    }
  }
}

module.exports = new PaymentController(); 