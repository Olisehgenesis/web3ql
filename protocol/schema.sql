-- Web3QL example schema
-- Two related tables: users and posts.
-- Each CREATE TABLE statement is compiled to its own on-chain proxy contract.

-- ────────────────────────────────────────────────────────────
--  Users table
--   id      INT     — primary key (required, must be INT)
--   name    TEXT    — display name
--   email   TEXT    — contact address (stored encrypted on-chain)
--   wallet  ADDRESS — linked EVM wallet
--   active  BOOL    — account status flag
-- ────────────────────────────────────────────────────────────
CREATE TABLE users (
  id      INT     PRIMARY KEY,
  name    TEXT,
  email   TEXT,
  wallet  ADDRESS,
  active  BOOL
);

-- ────────────────────────────────────────────────────────────
--  Posts table
--   id         INT   — primary key
--   user_id    INT   — foreign reference to users.id (by convention)
--   title      TEXT  — post title
--   content    TEXT  — post body (encrypted)
--   published  BOOL  — visibility flag
-- ────────────────────────────────────────────────────────────
CREATE TABLE posts (
  id         INT  PRIMARY KEY,
  user_id    INT,
  title      TEXT,
  content    TEXT,
  published  BOOL
);
