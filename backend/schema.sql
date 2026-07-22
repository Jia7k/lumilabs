-- Lumi5 Labs Database Schema
-- Run this file to initialize the database: mysql -u root -p lumi5_labs < schema.sql

CREATE DATABASE IF NOT EXISTS lumi5_labs;
USE lumi5_labs;

-- Users table (all roles share this table)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role ENUM('business_owner', 'investor', 'admin') NOT NULL DEFAULT 'business_owner',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Portfolios (startups submitted by business owners)
CREATE TABLE IF NOT EXISTS portfolios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  sector VARCHAR(100) NOT NULL,
  description TEXT,
  mvp_status ENUM('Idea','Prototype','Beta','Launched') NOT NULL DEFAULT 'Idea',
  funding_goal DECIMAL(15,2) DEFAULT 0,
  team_size INT,
  founded_year YEAR,
  location VARCHAR(255),
  website VARCHAR(500),
  monthly_revenue DECIMAL(15,2),
  user_count INT,
  growth_rate DECIMAL(5,2),
  market_size VARCHAR(500),
  competitor_analysis TEXT,
  advisor_names VARCHAR(500),
  burn_rate DECIMAL(15,2),
  runway_months INT,
  readiness_score INT DEFAULT 0 CHECK (readiness_score BETWEEN 0 AND 100),
  status ENUM('draft','pending','approved','rejected') NOT NULL DEFAULT 'draft',
  rejection_reason TEXT,
  submitted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Portfolio documents (pitch decks, financial statements, etc.)
CREATE TABLE IF NOT EXISTS portfolio_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  portfolio_id INT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  file_type VARCHAR(50),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
);

-- Investor interests (which investors expressed interest in which portfolio)
CREATE TABLE IF NOT EXISTS investor_interests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  investor_id INT NOT NULL,
  portfolio_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_interest (investor_id, portfolio_id),
  FOREIGN KEY (investor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
);

-- Messages between users (investor <-> business owner)
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sender_id INT NOT NULL,
  receiver_id INT NOT NULL,
  portfolio_id INT NULL,
  content TEXT NOT NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE SET NULL
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('new_message', 'new_interest', 'portfolio_approved', 'portfolio_rejected', 'portfolio_needs_changes', 'portfolio_submitted') NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT,
  related_portfolio_id INT NULL,
  related_user_id INT NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (related_portfolio_id) REFERENCES portfolios(id) ON DELETE SET NULL,
  FOREIGN KEY (related_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Audit logs (admin actions)
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  action ENUM('approved', 'rejected', 'requested_changes') NOT NULL,
  portfolio_id INT NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
);
