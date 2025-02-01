const db = require('../config/database');
const pixupConfig = require('../config/pixup');
const nodemailer = require('nodemailer');
const axios = require('axios');

// Configuração do transportador de email
const transporter = nodemailer.createTransport({
  host: 'smtp.hostinger.com',
  port: 465,
  secure: true, // true para 465, false para outras portas
  auth: {
    user: 'entrega@seurobux.com',
    pass: 'Galaxyreeform123@'
  },
  debug: true, // Ativa logs detalhados
  logger: true  // Mostra logs do SMTP
});

// Testar a conexão ao inicializar
transporter.verify((error, success) => {
  if (error) {
    console.error('Erro na configuração do email:', error);
  } else {
    console.log('Servidor de email pronto!');
  }
});

class PaymentController {
  constructor() {
    // Verificar a cada 1 minuto
    setInterval(this.checkExpiredPayments.bind(this), 60000);
  }

  async checkExpiredPayments() {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Buscar pagamentos pendentes que expiraram
      const [expiredPayments] = await connection.query(
        `SELECT p.id, p.external_id 
         FROM payments p
         WHERE p.status = 'pending' 
         AND p.created_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)
         AND EXISTS (
           SELECT 1 
           FROM stock_items si 
           WHERE si.payment_id = p.id 
           AND si.status = 'RESERVED'
         )`
      );

      console.log(`Encontrados ${expiredPayments.length} pagamentos expirados com itens reservados`);

      for (const payment of expiredPayments) {
        console.log(`Processando pagamento expirado ID: ${payment.id}`);

        // Liberar itens reservados
        const [updateResult] = await connection.query(
          `UPDATE stock_items 
           SET status = 'AVAILABLE', 
               payment_id = NULL 
           WHERE payment_id = ? 
           AND status = 'RESERVED'`,
          [payment.id]
        );

        console.log(`Itens liberados: ${updateResult.affectedRows}`);

        // Marcar pagamento como falho
        await connection.query(
          `UPDATE payments 
           SET status = 'failed', 
               completed_at = NOW() 
           WHERE id = ?`,
          [payment.id]
        );
      }

      await connection.commit();
      console.log('Verificação de pagamentos expirados concluída');
    } catch (error) {
      await connection.rollback();
      console.error('Erro ao verificar pagamentos expirados:', error);
    } finally {
      connection.release();
    }
  }

  async createPayment(req, res) {
    try {
      const { amount, items, email, customer } = req.body;
      console.log('Iniciando criação de pagamento:', { amount, email, customer });

      const paymentData = {
        amount: parseFloat(amount),
        external_id: `PAY-${Date.now()}`,
        payer: {
          name: customer.name,
          document: customer.document.replace(/\D/g, ''),
          email: email
        },
        payerQuestion: "Pagamento Galaxy Store",
        expiration: 300, 
        postbackUrl: `${process.env.BACKEND_URL}/api/payments/webhook`
      };

      console.log('Dados do pagamento:', paymentData);

      const connection = await db.getConnection();
      await connection.beginTransaction();

      try {
        const response = await pixupConfig.makeRequest('/pix/qrcode', 'POST', paymentData);
        console.log('Resposta do pagamento:', response);

        if (!response.qrcode) {
          throw new Error('QR Code não retornado');
        }

        const [result] = await connection.query(
          `INSERT INTO payments (
            external_id, 
            amount, 
            status, 
            pix_code,
            transaction_id,
            customer_email,
            customer_name,
            customer_document,
            expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
          [
            paymentData.external_id,
            amount,
            'pending',
            response.qrcode,
            response.transactionId,
            email,
            customer.name,
            customer.document
          ]
        );

        for (const item of items) {
          await connection.query(
            `UPDATE stock_items 
             SET payment_id = ?, 
                 status = 'RESERVED'
             WHERE product_id = ?
             AND status = 'AVAILABLE'
             LIMIT 1`,
            [result.insertId, item.id]
          );
        }

        await connection.commit();

        res.json({
          payment_id: result.insertId,
          qrcode: response.qrcode,
          transaction_id: response.transactionId,
          external_id: paymentData.external_id,
          expires_in: 300
        });

      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

    } catch (error) {
      console.error('Erro ao criar pagamento:', error);
      res.status(500).json({ 
        message: 'Erro ao processar pagamento',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  async handleWebhook(req, res) {
    try {
      const { requestBody } = req.body;
      console.log('Webhook recebido:', requestBody);

      if (!requestBody || 
          requestBody.transactionType !== "RECEIVEPIX" || 
          requestBody.status !== "PAID") {
        return res.status(200).json({ received: true });
      }

      const connection = await db.getConnection();
      await connection.beginTransaction();

      try {
        // Atualizar status do pagamento
        const [result] = await connection.query(
          `UPDATE payments 
           SET status = 'completed',
               completed_at = ?,
               transaction_id = ?
           WHERE external_id = ?
           AND status = 'pending'`,
          [
            requestBody.dateApproval,
            requestBody.transactionId,
            requestBody.external_id
          ]
        );

        if (result.affectedRows === 0) {
          await connection.rollback();
          return res.status(200).json({ received: true });
        }

        // Atualizar status dos itens
        await connection.query(
          `UPDATE stock_items 
           SET status = 'SOLD',
               sold_at = NOW()
           WHERE payment_id IN (
             SELECT id FROM payments 
             WHERE external_id = ?
           )
           AND status = 'RESERVED'`,
          [requestBody.external_id]
        );

        // Buscar informações para email e Discord
        const [items] = await connection.query(
          `SELECT s.code, p.*, pr.name as product_name
           FROM stock_items s
           INNER JOIN payments p ON p.id = s.payment_id
           LEFT JOIN products pr ON pr.id = s.product_id
           WHERE p.external_id = ?
           AND s.status = 'SOLD'`,
          [requestBody.external_id]
        );

        // Enviar email
        if (items.length > 0) {
          console.log('Preparando para enviar email para:', items[0].customer_email);
          
          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #28a745; text-align: center;">Seu pagamento foi confirmado!</h2>
              <p style="color: #666;">Olá ${items[0].customer_name},</p>
              <p style="color: #666;">Obrigado por sua compra! Aqui estão seus códigos:</p>
              <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                ${items.map(item => `
                  <div style="background: white; padding: 15px; margin: 10px 0; border-radius: 6px; font-family: monospace; font-size: 16px;">
                    ${item.code}
                  </div>
                `).join('')}
              </div>
              <p style="color: #666; font-size: 14px;">Guarde seus códigos com segurança!</p>
              <p style="color: #666; font-size: 14px;">Atenciosamente,<br>Equipe SeuRobux</p>
            </div>
          `;

          try {
            console.log('Tentando enviar email...');
            const info = await transporter.sendMail({
              from: {
                name: 'SeuRobux',
                address: 'entrega@seurobux.com'
              },
              to: items[0].customer_email,
              subject: 'Seus códigos chegaram! 🎮',
              html: emailHtml,
              priority: 'high'
            });

            console.log('Email enviado com sucesso:', {
              messageId: info.messageId,
              response: info.response,
              accepted: info.accepted,
              rejected: info.rejected
            });
          } catch (emailError) {
            console.error('Erro detalhado ao enviar email:', {
              error: emailError.message,
              code: emailError.code,
              command: emailError.command,
              response: emailError.response
            });
          }
        } else {
          console.log('Nenhum item encontrado para enviar por email');
        }

        // Enviar notificação Discord
        try {
          const [webhooks] = await connection.query('SELECT url FROM discord_webhooks LIMIT 1');
          if (webhooks.length > 0) {
            const webhook = webhooks[0].url;
            const message = {
              embeds: [{
                title: '💰 Nova Venda Aprovada!',
                color: 0x199a66,
                fields: [
                  {
                    name: 'Pedido',
                    value: requestBody.external_id,
                    inline: true
                  },
                  {
                    name: 'Valor',
                    value: `R$ ${Number(items[0]?.amount || 0).toFixed(2)}`,
                    inline: true
                  },
                  {
                    name: 'Cliente',
                    value: items[0]?.customer_name || 'N/A',
                    inline: true
                  },
                  {
                    name: 'Email',
                    value: items[0]?.customer_email || 'N/A',
                    inline: true
                  },
                  {
                    name: 'Produtos',
                    value: items.map(item => `• ${item.product_name || item.code}`).join('\n')
                  }
                ],
                footer: {
                  text: 'SeuRobux - Sistema de Vendas'
                },
                timestamp: new Date().toISOString()
              }]
            };

            await axios.post(webhook, message);
          }
        } catch (error) {
          console.error('Erro ao enviar notificação Discord:', error);
          // Não interrompe o fluxo em caso de erro no Discord
        }

        await connection.commit();
        return res.status(200).json({ success: true });

      } catch (error) {
        console.error('Erro na transação:', error);
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

    } catch (error) {
      console.error('Erro no webhook:', error);
      return res.status(500).json({ message: 'Erro interno' });
    }
  }

  async getPaymentStatus(req, res) {
    try {
      const { payment_id } = req.params;

      const [payment] = await db.query(
        `SELECT p.*, GROUP_CONCAT(s.code) as codes
         FROM payments p
         LEFT JOIN stock_items s ON s.payment_id = p.id AND s.status = 'SOLD'
         WHERE p.id = ?
         GROUP BY p.id`,
        [payment_id]
      );

      if (!payment[0]) {
        return res.status(404).json({ message: 'Pagamento não encontrado' });
      }

      if (payment[0].status === 'completed') {
        return res.json({
          status: 'completed',
          items: payment[0].codes ? payment[0].codes.split(',') : [],
          paid_at: payment[0].completed_at
        });
      }

      try {
        if (!payment[0].transaction_id) {
          return res.json({
            status: 'pending',
            message: 'Aguardando pagamento'
          });
        }

        const status = await pixupConfig.makeRequest(
          `/pix/qrcode/${payment[0].transaction_id}/status`,
          'GET'
        );

        if (status.status === "PAID") {
          await db.query(
              `UPDATE payments 
               SET status = 'completed',
                   completed_at = NOW()
               WHERE id = ? AND status = 'pending'`,
              [payment_id]
            );

          await db.query(
              `UPDATE stock_items 
               SET status = 'SOLD',
                   sold_at = NOW()
             WHERE payment_id = ? AND status = 'RESERVED'`,
              [payment_id]
            );

          return res.json({
            status: 'completed',
            message: 'Pagamento confirmado'
          });
        }

        return res.json({
          status: 'pending',
          message: 'Aguardando pagamento'
        });

      } catch (error) {
        console.error('Erro ao verificar status:', error);
        return res.json({
          status: payment[0].status,
          message: 'Aguardando confirmação'
        });
      }
    } catch (error) {
      console.error('Erro ao buscar status:', error);
      res.status(500).json({ message: 'Erro interno' });
    }
  }

  async getPaymentStatusByExternalId(req, res) {
    try {
      const { external_id } = req.params;

      const [[payment]] = await db.query(
        `SELECT 
          p.*,
          GROUP_CONCAT(si.code) as codes,
          GROUP_CONCAT(pr.name) as product_names
         FROM payments p
         LEFT JOIN stock_items si ON p.id = si.payment_id
         LEFT JOIN products pr ON pr.id = si.product_id
         WHERE p.external_id = ?
         GROUP BY p.id`,
        [external_id]
      );

      if (!payment) {
        return res.status(404).json({ message: 'Pagamento não encontrado' });
      }

      return res.json({
        status: payment.status,
        items: payment.codes ? payment.codes.split(',') : [],
        products: payment.product_names ? payment.product_names.split(',') : [],
        paid_at: payment.completed_at,
        message: payment.status === 'completed' ? 'Pagamento confirmado' : 'Aguardando pagamento'
      });

    } catch (error) {
      console.error('Erro ao buscar status:', error);
      res.status(500).json({ message: 'Erro interno' });
    }
  }

  async getSoldItems(req, res) {
    try {
      const { external_id } = req.params;

      // Busca os códigos dos itens vendidos
      const [items] = await db.query(
        `SELECT s.code
         FROM stock_items s
         INNER JOIN payments p ON p.id = s.payment_id
         WHERE p.external_id = ?
         AND s.status = 'SOLD'`,
        [external_id]
      );

      // Retorna array de códigos
      return res.json(items.map(item => item.code));

    } catch (error) {
      console.error('Erro ao buscar itens vendidos:', error);
      res.status(500).json({ message: 'Erro interno' });
    }
  }

  async getSales(req, res) {
    try {
      const { startDate, endDate, status, search, page = 1, limit = 25 } = req.query;
      
      let query = `
        SELECT 
          p.*,
          GROUP_CONCAT(DISTINCT pr.name) as product_names
        FROM payments p
        LEFT JOIN stock_items si ON si.payment_id = p.id
        LEFT JOIN products pr ON pr.id = si.product_id
      `;
      
      const conditions = [];
      const params = [];
      
      if (startDate) {
        conditions.push('p.created_at >= ?');
        params.push(startDate);
      }
      
      if (endDate) {
        conditions.push('p.created_at <= ?');
        params.push(endDate);
      }
      
      if (status) {
        conditions.push('p.status = ?');
        params.push(status);
      }
      
      if (search) {
        conditions.push('(p.customer_email LIKE ? OR p.customer_name LIKE ? OR pr.name LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      
      if (conditions.length) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' GROUP BY p.id ORDER BY p.created_at DESC';
      
      // Contar total antes da paginação
      const [countResult] = await db.query(`SELECT COUNT(*) as total FROM (${query}) as subquery`, params);
      const total = countResult[0].total;
      
      // Adicionar paginação
      query += ' LIMIT ? OFFSET ?';
      params.push(Number(limit), (page - 1) * Number(limit));
      
      const [sales] = await db.query(query, params);
      
      res.json({
        sales: sales.map(sale => ({
          ...sale,
          product_names: sale.product_names ? sale.product_names.split(',') : []
        })),
        pagination: {
          total,
          pages: Math.ceil(total / limit),
          currentPage: Number(page),
          limit: Number(limit)
        }
      });
    } catch (error) {
      console.error('Erro ao buscar vendas:', error);
      res.status(500).json({ error: 'Erro ao buscar vendas' });
    }
  }

  // Adicionar método para estatísticas do dashboard
  async getDashboardStats(req, res) {
    try {
      const stats = {
        today: { total: 0, count: 0 },
        week: { total: 0, count: 0 },
        month: { total: 0, count: 0 },
        allTime: { total: 0, count: 0 },
        topProducts: [],
        recentSales: [],
        chartData: []
      };

      // Estatísticas gerais
      const [generalStats] = await db.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN DATE(completed_at) = CURDATE() THEN amount ELSE 0 END), 0) as today_total,
          COUNT(CASE WHEN DATE(completed_at) = CURDATE() THEN 1 END) as today_count,
          COALESCE(SUM(CASE WHEN completed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN amount ELSE 0 END), 0) as week_total,
          COUNT(CASE WHEN completed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as week_count,
          COALESCE(SUM(CASE WHEN completed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN amount ELSE 0 END), 0) as month_total,
          COUNT(CASE WHEN completed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as month_count,
          COALESCE(SUM(amount), 0) as all_time_total,
          COUNT(*) as all_time_count
        FROM payments
        WHERE status = 'completed'
      `);

      // Converter valores para números
      stats.today = { 
        total: Number(generalStats[0].today_total || 0), 
        count: Number(generalStats[0].today_count || 0)
      };
      stats.week = { 
        total: Number(generalStats[0].week_total || 0), 
        count: Number(generalStats[0].week_count || 0)
      };
      stats.month = { 
        total: Number(generalStats[0].month_total || 0), 
        count: Number(generalStats[0].month_count || 0)
      };
      stats.allTime = { 
        total: Number(generalStats[0].all_time_total || 0), 
        count: Number(generalStats[0].all_time_count || 0)
      };

      // Top 10 produtos
      const [topProducts] = await db.query(`
        SELECT 
          p.name,
          COUNT(*) as sales_count,
          COALESCE(SUM(pay.amount), 0) as total_amount
        FROM stock_items si
        JOIN products p ON p.id = si.product_id
        JOIN payments pay ON pay.id = si.payment_id
        WHERE si.status = 'SOLD'
        AND pay.status = 'completed'
        GROUP BY p.id
        ORDER BY sales_count DESC
        LIMIT 10
      `);

      // Converter valores para números
      stats.topProducts = topProducts.map(product => ({
        ...product,
        sales_count: Number(product.sales_count),
        total_amount: Number(product.total_amount)
      }));

      // Últimas 10 vendas
      const [recentSales] = await db.query(`
        SELECT 
          p.*,
          GROUP_CONCAT(DISTINCT pr.name) as product_names,
          GROUP_CONCAT(si.code) as items
        FROM payments p
        LEFT JOIN stock_items si ON si.payment_id = p.id
        LEFT JOIN products pr ON pr.id = si.product_id
        WHERE p.status = 'completed'
        AND p.completed_at IS NOT NULL
        GROUP BY p.id, p.completed_at
        ORDER BY p.completed_at DESC, p.id DESC
        LIMIT 10
      `);

      // Formatar vendas recentes
      stats.recentSales = recentSales.map(sale => ({
        ...sale,
        amount: Number(sale.amount),
        items: sale.items ? sale.items.split(',') : [],
        product_names: sale.product_names ? sale.product_names.split(',') : [],
        completed_at: sale.completed_at // Manter o timestamp para ordenação correta
      }));

      // Ordenar novamente para garantir a ordem mais recente primeiro
      stats.recentSales.sort((a, b) => {
        const dateA = new Date(a.completed_at);
        const dateB = new Date(b.completed_at);
        return dateB - dateA;
      });

      // Dados do gráfico (últimos 7 dias)
      const [chartData] = await db.query(`
        WITH RECURSIVE dates AS (
          SELECT 
            DATE_SUB(CURRENT_DATE,
              INTERVAL DAYOFWEEK(CURRENT_DATE) - 2 DAY
            ) as date
          UNION ALL
          SELECT date + INTERVAL 1 DAY
          FROM dates
          WHERE date < DATE_SUB(CURRENT_DATE,
            INTERVAL DAYOFWEEK(CURRENT_DATE) - 8 DAY
          )
        )
        SELECT 
          dates.date,
          DAYNAME(dates.date) as day_name,
          COUNT(DISTINCT p.id) as sales_count,
          COALESCE(SUM(p.amount), 0) as total_amount
        FROM dates
        LEFT JOIN payments p ON DATE(p.completed_at) = dates.date 
          AND p.status = 'completed'
        GROUP BY dates.date, DAYNAME(dates.date)
        ORDER BY dates.date
      `);

      // Converter valores do gráfico para números e adicionar nome do dia
      stats.chartData = chartData.map(data => ({
        ...data,
        sales_count: Number(data.sales_count),
        total_amount: Number(data.total_amount),
        date: data.date,
        day_name: data.day_name,
        // Traduzir os dias da semana
        day_name_pt: {
          'Sunday': 'Domingo',
          'Monday': 'Segunda',
          'Tuesday': 'Terça',
          'Wednesday': 'Quarta',
          'Thursday': 'Quinta',
          'Friday': 'Sexta',
          'Saturday': 'Sábado'
        }[data.day_name]
      }));

      res.json(stats);
    } catch (error) {
      console.error('Erro ao buscar estatísticas:', error);
      res.status(500).json({ message: 'Erro interno' });
    }
  }
}

module.exports = new PaymentController(); 