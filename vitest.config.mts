import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const testBindings = {
  STRIPE_RESTRICTED_KEY: "rk_test_unit_test_key_not_real_0001",
  DOWNLOAD_SIGNING_SECRET: "unit-test-signing-secret-32chars-minimum",
  STRIPE_WEBHOOK_SECRET: "whsec_unit_test_webhook_secret_value_0001",
  DOWNLOAD_LIMIT: "5",
  DOWNLOAD_TTL_SECONDS: "900",
  RATE_LIMIT_IP_PER_MINUTE: "60",
  RATE_LIMIT_SESSION_PER_MINUTE: "20",
  PRODUCT_FIELD_KIT_TEST_LINKS: "plink_fieldkittest",
  PRODUCT_FIELD_KIT_TEST_PRICES: "price_fieldkittest",
  PRODUCT_FIELD_KIT_LIVE_LINKS: "plink_fieldkitlive",
  PRODUCT_FIELD_KIT_LIVE_PRICES: "price_fieldkitlive",
  PRODUCT_FIELD_KIT_KEY: "products/field-kit.zip",
  PRODUCT_FIELD_KIT_FILENAME: "nixonmade-field-kit.zip",
  PRODUCT_FIELD_KIT_TITLE: "Field Kit",
  PRODUCT_SHIP_KIT_TEST_LINKS: "plink_shipkittest,plink_shipdfytest",
  PRODUCT_SHIP_KIT_TEST_PRICES: "price_shipkittest,price_shipdfytest",
  PRODUCT_SHIP_KIT_LIVE_LINKS: "plink_shipkitlive",
  PRODUCT_SHIP_KIT_LIVE_PRICES: "price_shipkitlive",
  PRODUCT_SHIP_KIT_KEY: "products/ship-kit.zip",
  PRODUCT_SHIP_KIT_FILENAME: "nixonmade-ship-kit.zip",
  PRODUCT_SHIP_KIT_TITLE: "Ship Kit",
  PRODUCT_FLEET_SHEETS_TEST_LINKS: "plink_fleettest01",
  PRODUCT_FLEET_SHEETS_TEST_PRICES: "price_fleettest01",
  PRODUCT_FLEET_SHEETS_LIVE_LINKS: "plink_fleetlive01",
  PRODUCT_FLEET_SHEETS_LIVE_PRICES: "price_fleetlive01",
  PRODUCT_FLEET_SHEETS_KEY: "products/fleet-sheets.zip",
  PRODUCT_FLEET_SHEETS_FILENAME: "nixonmade-fleet-sheets.zip",
  PRODUCT_FLEET_SHEETS_TITLE: "Fleet Sheets",
};

export default defineConfig({
  test: {
    fileParallelism: false,
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: testBindings,
      },
    }),
  ],
});
