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
  role ENUM('business_owner','investor','relationship_manager','admin','superadmin') NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Portfolios (startups submitted by business owners)
CREATE TABLE IF NOT EXISTS portfolios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  sector VARCHAR(100) NOT NULL,
  description TEXT,
  mvp_status ENUM('Idea','Prototype','Beta','Launched') NOT NULL,
  funding_goal DECIMAL(15,2) NOT NULL,
  team_size INT,
  founded_year YEAR,
  location VARCHAR(255),
  website VARCHAR(500),
  readiness_score INT NULL DEFAULT 0,
  status ENUM('draft','pending','approved','rejected') NOT NULL DEFAULT 'draft',
  rejection_reason TEXT,
  submitted_at TIMESTAMP NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  monthly_revenue DECIMAL(15,2),
  user_count INT,
  growth_rate DECIMAL(5,2),
  market_size VARCHAR(500),
  competitor_analysis TEXT,
  advisor_names VARCHAR(500),
  burn_rate DECIMAL(15,2),
  runway_months INT,
  relationship_manager_id INT NULL,
  KEY fk_relationship_manager (relationship_manager_id),
  CONSTRAINT fk_relationship_manager FOREIGN KEY (relationship_manager_id)
    REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Portfolio documents (pitch decks, financial statements, etc.)
CREATE TABLE IF NOT EXISTS portfolio_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  portfolio_id INT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  file_type VARCHAR(50),
  uploaded_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Investor interests (which investors expressed interest in which portfolio)
CREATE TABLE IF NOT EXISTS investor_interests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  investor_id INT NOT NULL,
  portfolio_id INT NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_interest (investor_id, portfolio_id),
  FOREIGN KEY (investor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One relationship-manager-overseen room per portfolio
CREATE TABLE IF NOT EXISTS conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  portfolio_id INT NULL,
  relationship_manager_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  archived_reason ENUM('manual','no_active_investors','portfolio_unapproved','portfolio_deleted') NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_conversation_portfolio (portfolio_id),
  CONSTRAINT fk_conversations_portfolio FOREIGN KEY (portfolio_id)
    REFERENCES portfolios(id) ON DELETE SET NULL,
  CONSTRAINT fk_conversations_manager FOREIGN KEY (relationship_manager_id)
    REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Room memberships. The generated singleton key permits multiple investors,
-- while retaining database enforcement for one manager and one owner.
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INT NOT NULL,
  user_id INT NOT NULL,
  member_role ENUM('relationship_manager','business_owner','investor') NOT NULL,
  singleton_role VARCHAR(24)
    GENERATED ALWAYS AS (
      CASE
        WHEN membership_status = 'active'
         AND member_role IN ('relationship_manager','business_owner')
        THEN member_role
        ELSE NULL
      END
    ) STORED,
  membership_status ENUM('active','removed') NOT NULL DEFAULT 'active',
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP NULL,
  visible_after_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id),
  UNIQUE KEY unique_conversation_singleton (conversation_id, singleton_role),
  KEY idx_members_user_status (user_id, membership_status),
  CONSTRAINT fk_members_conversation FOREIGN KEY (conversation_id)
    REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_members_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Persistent group messages
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender_id INT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_messages_conversation_id (conversation_id, id),
  CONSTRAINT fk_messages_member FOREIGN KEY (conversation_id, sender_id)
    REFERENCES conversation_members(conversation_id, user_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('new_message','new_interest','portfolio_approved','portfolio_rejected','portfolio_needs_changes','portfolio_submitted','conversation_created','conversation_member_added','conversation_archived','portfolio_assigned','portfolio_reassigned','portfolio_unassigned','conversation_member_removed') NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT,
  related_portfolio_id INT NULL,
  related_conversation_id INT NULL,
  related_message_id INT NULL,
  related_user_id INT NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  KEY user_id (user_id),
  KEY related_portfolio_id (related_portfolio_id),
  KEY idx_notifications_conversation (related_conversation_id),
  KEY idx_notifications_message (related_message_id),
  KEY related_user_id (related_user_id),
  CONSTRAINT notifications_ibfk_1 FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT notifications_ibfk_2 FOREIGN KEY (related_portfolio_id)
    REFERENCES portfolios(id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_conversation FOREIGN KEY (related_conversation_id)
    REFERENCES conversations(id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_message FOREIGN KEY (related_message_id)
    REFERENCES messages(id) ON DELETE SET NULL,
  CONSTRAINT notifications_ibfk_3 FOREIGN KEY (related_user_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Audit logs (admin actions)
-- Accepted product behavior: deleting an editable portfolio also deletes its audit rows.
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  action ENUM('approved','rejected') NOT NULL,
  portfolio_id INT NOT NULL,
  reason TEXT,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Immutable snapshots of assignment and privileged account-management actions
CREATE TABLE IF NOT EXISTS superadmin_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  superadmin_id INT DEFAULT NULL,
  superadmin_id_snapshot INT NOT NULL,
  superadmin_name_snapshot VARCHAR(100) NOT NULL,
  superadmin_email_snapshot VARCHAR(255) NOT NULL,
  action ENUM('portfolio_assigned','portfolio_reassigned','portfolio_unassigned','admin_account_created','relationship_manager_account_created') NOT NULL,
  portfolio_id INT DEFAULT NULL,
  portfolio_id_snapshot INT DEFAULT NULL,
  portfolio_name_snapshot VARCHAR(255) DEFAULT NULL,
  previous_relationship_manager_id INT DEFAULT NULL,
  previous_relationship_manager_id_snapshot INT DEFAULT NULL,
  previous_relationship_manager_name_snapshot VARCHAR(100) DEFAULT NULL,
  previous_relationship_manager_email_snapshot VARCHAR(255) DEFAULT NULL,
  new_relationship_manager_id INT DEFAULT NULL,
  new_relationship_manager_id_snapshot INT DEFAULT NULL,
  new_relationship_manager_name_snapshot VARCHAR(100) DEFAULT NULL,
  new_relationship_manager_email_snapshot VARCHAR(255) DEFAULT NULL,
  created_user_id INT DEFAULT NULL,
  created_user_id_snapshot INT DEFAULT NULL,
  created_user_name_snapshot VARCHAR(100) DEFAULT NULL,
  created_user_email_snapshot VARCHAR(255) DEFAULT NULL,
  created_user_role ENUM('admin','relationship_manager') DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_superadmin_audit_actor (superadmin_id, created_at),
  KEY idx_superadmin_audit_action (action, created_at),
  KEY idx_superadmin_audit_portfolio (portfolio_id, created_at),
  KEY idx_superadmin_audit_previous_manager (previous_relationship_manager_id),
  KEY idx_superadmin_audit_new_manager (new_relationship_manager_id),
  KEY idx_superadmin_audit_created_user (created_user_id),
  CONSTRAINT fk_superadmin_audit_actor FOREIGN KEY (superadmin_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_superadmin_audit_created_user FOREIGN KEY (created_user_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_superadmin_audit_new_manager FOREIGN KEY (new_relationship_manager_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_superadmin_audit_portfolio FOREIGN KEY (portfolio_id)
    REFERENCES portfolios(id) ON DELETE SET NULL,
  CONSTRAINT fk_superadmin_audit_previous_manager FOREIGN KEY (previous_relationship_manager_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Public website Contact submissions
CREATE TABLE IF NOT EXISTS contact_submissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contact_submissions_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
