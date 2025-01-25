-- Tabela de estoque
CREATE TABLE stock_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  code VARCHAR(255) NOT NULL,
  status ENUM('AVAILABLE', 'SOLD', 'RESERVED') DEFAULT 'AVAILABLE',
  sold_at DATETIME,
  sold_to VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  payment_id INT,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (payment_id) REFERENCES payments(id)
);

-- Índices para otimização
CREATE INDEX idx_product_id ON stock_items(product_id);
CREATE INDEX idx_status ON stock_items(status);
CREATE INDEX idx_code ON stock_items(code);

CREATE TABLE payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  external_id VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
  pix_code TEXT,
  customer_email VARCHAR(255),
  reference VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Adicionar índices
CREATE INDEX idx_external_id ON payments(external_id);
CREATE INDEX idx_reference ON payments(reference);
CREATE INDEX idx_status ON payments(status);

ALTER TABLE stock_items ADD COLUMN payment_id INT;
ALTER TABLE stock_items ADD FOREIGN KEY (payment_id) REFERENCES payments(id); 