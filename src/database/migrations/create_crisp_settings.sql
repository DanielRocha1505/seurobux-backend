CREATE TABLE IF NOT EXISTS crisp_settings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  website_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
); 