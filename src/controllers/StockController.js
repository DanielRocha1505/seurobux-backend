const db = require('../config/database');

class StockController {
  async addItems(req, res) {
    console.log('Recebendo requisição:', req.body);
    const { product_id, items } = req.body;

    try {
      if (!product_id || !items || !Array.isArray(items)) {
        return res.status(400).json({ 
          error: 'Dados inválidos. Necessário product_id e array de items' 
        });
      }

      const [product] = await db.query('SELECT * FROM products WHERE id = ?', [product_id]);
      
      if (product.length === 0) {
        return res.status(404).json({ error: 'Produto não encontrado' });
      }

      const values = items.map(code => [product_id, code.trim(), 'AVAILABLE']);
      
      await db.query(
        'INSERT INTO stock_items (product_id, code, status) VALUES ?',
        [values]
      );

      await db.query(
        `UPDATE products SET 
         stock = (SELECT COUNT(*) FROM stock_items WHERE product_id = ? AND status = 'AVAILABLE')
         WHERE id = ?`,
        [product_id, product_id]
      );

      res.status(201).json({ message: 'Itens adicionados ao estoque' });
    } catch (error) {
      console.error('Erro ao adicionar itens:', error);
      res.status(500).json({ error: 'Erro ao adicionar itens ao estoque' });
    }
  }

  async listItems(req, res) {
    const { product_id } = req.params;
    const { status } = req.query;

    try {
      let query = `
        SELECT 
          si.*,
          p.customer_email as sold_to,
          p.customer_name,
          p.external_id as transaction_id,
          p.completed_at as sale_date
        FROM stock_items si
        LEFT JOIN payments p ON p.id = si.payment_id
        WHERE si.product_id = ?
      `;
      
      const params = [product_id];

      if (status) {
        query += ' AND si.status = ?';
        params.push(status);
      }

      query += ' ORDER BY si.created_at DESC';

      const [items] = await db.query(query, params);
      
      // Formatar os dados
      const formattedItems = items.map(item => ({
        ...item,
        sold_to: item.sold_to || '-',
        customer_name: item.customer_name || '-',
        transaction_id: item.transaction_id || '-',
        sale_date: item.sale_date ? new Date(item.sale_date).toLocaleString() : '-'
      }));

      res.json(formattedItems);
    } catch (error) {
      console.error('Erro ao listar itens:', error);
      res.status(500).json({ error: 'Erro ao listar itens do estoque' });
    }
  }

  async markAsSold(req, res) {
    const { item_id } = req.params;
    const { email } = req.body;

    try {
      const [item] = await db.query(
        'SELECT * FROM stock_items WHERE id = ? AND status = "AVAILABLE"',
        [item_id]
      );

      if (item.length === 0) {
        return res.status(404).json({ error: 'Item não disponível' });
      }

      await db.query(
        `UPDATE stock_items 
         SET status = "SOLD", sold_at = NOW(), sold_to = ? 
         WHERE id = ?`,
        [email, item_id]
      );

      await db.query(
        `UPDATE products SET 
         stock = (SELECT COUNT(*) FROM stock_items WHERE product_id = ? AND status = 'AVAILABLE')
         WHERE id = ?`,
        [item[0].product_id, item[0].product_id]
      );

      res.json({ message: 'Item marcado como vendido' });
    } catch (error) {
      console.error('Erro ao marcar item como vendido:', error);
      res.status(500).json({ error: 'Erro ao marcar item como vendido' });
    }
  }

  async getNextAvailable(req, res) {
    const { product_id } = req.params;

    try {
      const [item] = await db.query(
        'SELECT * FROM stock_items WHERE product_id = ? AND status = "AVAILABLE" ORDER BY created_at ASC LIMIT 1',
        [product_id]
      );

      if (item.length === 0) {
        return res.status(404).json({ error: 'Nenhum item disponível' });
      }

      res.json(item[0]);
    } catch (error) {
      console.error('Erro ao obter próximo item:', error);
      res.status(500).json({ error: 'Erro ao obter próximo item disponível' });
    }
  }

  async removeItems(req, res) {
    const { items } = req.body;

    try {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Lista de itens inválida' });
      }

      await db.query(
        'DELETE FROM stock_items WHERE id IN (?) AND status = "AVAILABLE"',
        [items]
      );

      const [affectedProducts] = await db.query(
        'SELECT DISTINCT product_id FROM stock_items WHERE id IN (?)',
        [items]
      );

      for (const { product_id } of affectedProducts) {
        await db.query(
          `UPDATE products SET 
           stock = (SELECT COUNT(*) FROM stock_items WHERE product_id = ? AND status = 'AVAILABLE')
           WHERE id = ?`,
          [product_id, product_id]
        );
      }

      res.json({ message: 'Itens removidos com sucesso' });
    } catch (error) {
      console.error('Erro ao remover itens:', error);
      res.status(500).json({ error: 'Erro ao remover itens do estoque' });
    }
  }

  async updateItem(req, res) {
    const { id } = req.params;
    const { code } = req.body;

    try {
      const [existing] = await db.query(
        'SELECT id FROM stock_items WHERE code = ? AND id != ?',
        [code, id]
      );

      if (existing.length > 0) {
        return res.status(400).json({ error: 'Código já está em uso' });
      }

      await db.query(
        'UPDATE stock_items SET code = ? WHERE id = ?',
        [code, id]
      );

      res.json({ message: 'Item atualizado com sucesso' });
    } catch (error) {
      console.error('Erro ao atualizar item:', error);
      res.status(500).json({ error: 'Erro ao atualizar item' });
    }
  }
}

module.exports = new StockController(); 