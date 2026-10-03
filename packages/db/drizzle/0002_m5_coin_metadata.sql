CREATE TABLE "coin_metadata" (
	"id" text PRIMARY KEY NOT NULL,
	"mint" text,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"description" text NOT NULL,
	"image_mime" text NOT NULL,
	"image_base64" text NOT NULL,
	"twitter" text,
	"telegram" text,
	"website" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
