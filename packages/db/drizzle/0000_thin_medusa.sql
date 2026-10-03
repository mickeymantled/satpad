CREATE TYPE "public"."ledger_status" AS ENUM('built', 'sent', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ledger_type" AS ENUM('collect_creator_fee', 'settle', 'pay_payee', 'release_rewards', 'rewards_transfer', 'draw_lp', 'lp_deposit', 'buyback', 'set_split', 'set_wallets', 'set_pause', 'set_coin_pause', 'recover', 'set_lp', 'initialize');--> statement-breakpoint
CREATE TYPE "public"."payee_mode" AS ENUM('wallet', 'holders');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('dust', 'mining', 'block');--> statement-breakpoint
CREATE TABLE "coins" (
	"mint" text PRIMARY KEY NOT NULL,
	"name" text,
	"symbol" text,
	"uri" text,
	"deployer" text NOT NULL,
	"payee" text NOT NULL,
	"payee_mode" "payee_mode" NOT NULL,
	"treasury_only" boolean DEFAULT false NOT NULL,
	"stage" "stage" DEFAULT 'dust' NOT NULL,
	"curve_progress_bps" integer DEFAULT 0 NOT NULL,
	"bonding_curve" text NOT NULL,
	"pool" text,
	"created_at" timestamp with time zone NOT NULL,
	"graduated_at" timestamp with time zone,
	"paused" boolean DEFAULT false NOT NULL,
	"updated_slot" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keeper_health" (
	"loop" text NOT NULL,
	"instance" text NOT NULL,
	"last_ok_at" timestamp with time zone NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "keeper_health_loop_instance_pk" PRIMARY KEY("loop","instance")
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"signature" text,
	"type" "ledger_type" NOT NULL,
	"mint" text,
	"actor" text NOT NULL,
	"amounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "ledger_status" DEFAULT 'built' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"slot" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "ledger_mint_idx" ON "ledger" USING btree ("mint");--> statement-breakpoint
CREATE INDEX "ledger_type_idx" ON "ledger" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ledger_sig_idx" ON "ledger" USING btree ("signature");