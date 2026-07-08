import { pgTable, text, boolean, timestamp, serial, integer, uniqueIndex, index, jsonb } from 'drizzle-orm/pg-core'

export const accounts = pgTable('accounts', {
  did: text('did').primaryKey(),
  handle: text('handle').notNull(),
  displayName: text('display_name'),
  description: text('description'),
  avatar: text('avatar'),
  isCustomDomain: boolean('is_custom_domain').notNull().default(false),
  seedSource: text('seed_source'),
  indexedAt: timestamp('indexed_at', { withTimezone: true }).defaultNow(),
  followersCount: integer('followers_count'),
  followsCount: integer('follows_count'),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  lastActiveCheckedAt: timestamp('last_active_checked_at', { withTimezone: true }),
}, (t) => ({ handleIdx: index('accounts_handle_idx').on(t.handle) }))

export const accountVerifications = pgTable('account_verifications', {
  subjectDid: text('subject_did').notNull(),
  verifierDid: text('verifier_did').notNull(),
  recordUri: text('record_uri').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }),
}, (t) => ({ uniq: uniqueIndex('av_uniq').on(t.subjectDid, t.verifierDid) }))

export const accountSignals = pgTable('account_signals', {
  subjectDid: text('subject_did').primaryKey(),
  followedByVerified: boolean('followed_by_verified').notNull().default(false),
  verifiedFollowers: jsonb('verified_followers').$type<string[]>().default([]),
})

export const trustedVerifiers = pgTable('trusted_verifiers', {
  did: text('did').primaryKey(),
  handle: text('handle'),
  sourceListUri: text('source_list_uri'),
})

export const trustedVerifierAllowlist = pgTable('trusted_verifier_allowlist', {
  did: text('did').primaryKey(),
  handle: text('handle'),
  enabled: boolean('enabled').notNull().default(true),
  addedBy: text('added_by'),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
})

export const orgs = pgTable('orgs', {
  id: serial('id').primaryKey(),
  did: text('did').notNull().unique(),
  handle: text('handle').notNull(),
  scopes: text('scopes'),
  status: text('status').notNull().default('active'),
  onboardedByDid: text('onboarded_by_did'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const members = pgTable('members', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull(),
  memberDid: text('member_did').notNull(),
  handle: text('handle'),
  role: text('role').notNull(), // 'owner' | 'helper'
  status: text('status').notNull().default('active'), // 'active' | 'revoked'
  invitedByDid: text('invited_by_did'),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
}, (t) => ({ uniq: uniqueIndex('members_uniq').on(t.orgId, t.memberDid) }))

export const backlogItems = pgTable('backlog_items', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull(),
  subjectDid: text('subject_did').notNull(),
  status: text('status').notNull().default('pending'), // pending|verified|skipped|removed
  addedByDid: text('added_by_did'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({ uniq: uniqueIndex('backlog_uniq').on(t.orgId, t.subjectDid) }))

export const verificationActions = pgTable('verification_actions', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull(),
  actorDid: text('actor_did').notNull(),
  action: text('action').notNull(), // 'verify' | 'revoke'
  subjectDid: text('subject_did').notNull(),
  recordUri: text('record_uri'),
  outcome: text('outcome').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const crawlRuns = pgTable('crawl_runs', {
  id: serial('id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  stats: jsonb('stats').$type<Record<string, number>>(),
})

export const crawlSeeds = pgTable('crawl_seeds', {
  id: serial('id').primaryKey(),
  keyword: text('keyword').notNull().unique(),
  enabled: boolean('enabled').notNull().default(true),
})

// OAuth persistence (encrypted payloads)
export const oauthState = pgTable('oauth_state', {
  key: text('key').primaryKey(),
  payload: text('payload').notNull(), // encrypted JSON
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
export const oauthSession = pgTable('oauth_session', {
  did: text('did').primaryKey(),
  payload: text('payload').notNull(), // encrypted JSON
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})
