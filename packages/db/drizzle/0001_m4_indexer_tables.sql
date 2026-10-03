CREATE TYPE "public"."bridge_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."bridge_status" AS ENUM('quoted', 'pending_deposit', 'processing', 'success', 'refunded', 'failed', 'held');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."venue" AS ENUM('curve', 'pool');--> statement-breakpoint
CREATE TABLE "bridge_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"direction" "bridge_direction" NOT NULL,
	"solana_wallet" text NOT NULL,
	"intents_deposit_address" text,
	"amount" numeric(30, 0) NOT NULL,
	"status" "bridge_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fees" (
	"signature" text PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"creator_fee_btc" numeric(30, 0) NOT NULL,
	"liquidity" numeric(30, 0) NOT NULL,
	"buyback" numeric(30, 0) NOT NULL,
	"operator" numeric(30, 0) NOT NULL,
	"deployer" numeric(30, 0) NOT NULL,
	"slot" bigint NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "holders" (
	"mint" text NOT NULL,
	"wallet" text NOT NULL,
	"balance" numeric(30, 0) NOT NULL,
	"updated_slot" bigint NOT NULL,
	CONSTRAINT "holders_mint_wallet_pk" PRIMARY KEY("mint","wallet")
);
--> statement-breakpoint
CREATE TABLE "indexer_cursor" (
	"address" text PRIMARY KEY NOT NULL,
	"last_signature" text,
	"last_slot" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lp_runs" (
	"signature" text PRIMARY KEY NOT NULL,
	"btc_drawn" numeric(30, 0) NOT NULL,
	"satpad_bought" numeric(30, 0) DEFAULT '0' NOT NULL,
	"lp_minted" numeric(30, 0) DEFAULT '0' NOT NULL,
	"lp_burned" numeric(30, 0) DEFAULT '0' NOT NULL,
	"pool_reserves_after" jsonb,
	"slot" bigint NOT NULL,
	"ran_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processed_tx" (
	"signature" text PRIMARY KEY NOT NULL,
	"slot" bigint NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rewards_runs" (
	"mint" text NOT NULL,
	"run_index" bigint NOT NULL,
	"snapshot_hash" text NOT NULL,
	"snapshot_url" text,
	"pot_btc" numeric(30, 0) NOT NULL,
	"holders_paid" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"transfer_signatures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"release_signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "rewards_runs_mint_run_index_pk" PRIMARY KEY("mint","run_index")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"signature" text NOT NULL,
	"ix_index" integer DEFAULT 0 NOT NULL,
	"mint" text NOT NULL,
	"side" "trade_side" NOT NULL,
	"btc_amount" numeric(30, 0) NOT NULL,
	"token_amount" numeric(30, 0) NOT NULL,
	"price_btc_scaled" numeric(40, 0) NOT NULL,
	"trader" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" timestamp with time zone,
	"venue" "venue" NOT NULL,
	"creator_fee_btc" numeric(30, 0),
	CONSTRAINT "trades_signature_ix_index_pk" PRIMARY KEY("signature","ix_index")
);
--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "buys" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "sells" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "volume_btc" numeric(30, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "virtual_quote_reserves" numeric(30, 0);--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "virtual_token_reserves" numeric(30, 0);--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "real_token_reserves" numeric(30, 0);--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "token_total_supply" numeric(30, 0);--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "btc_paid_to_holders" numeric(30, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "holder_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "last_trade_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "indexed_slot" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "bridge_wallet_idx" ON "bridge_transfers" USING btree ("solana_wallet");--> statement-breakpoint
CREATE INDEX "fees_mint_idx" ON "fees" USING btree ("mint");--> statement-breakpoint
CREATE INDEX "holders_mint_balance_idx" ON "holders" USING btree ("mint","balance");--> statement-breakpoint
CREATE UNIQUE INDEX "processed_tx_sig_idx" ON "processed_tx" USING btree ("signature");--> statement-breakpoint
CREATE INDEX "trades_mint_slot_idx" ON "trades" USING btree ("mint","slot");--> statement-breakpoint
CREATE INDEX "trades_trader_idx" ON "trades" USING btree ("trader");--> statement-breakpoint
CREATE INDEX "trades_time_idx" ON "trades" USING btree ("block_time");