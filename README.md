# PocketBase LemonSqueezy Integration

This is a PocketBase plugin that provides integration with the LemonSqueezy API for handling subscriptions, checkouts, and product synchronization.

## Features

- Webhook handling for LemonSqueezy events (subscriptions created, cancelled, payments)
- Customer portal integration
- Checkout session creation
- Automatic product/variant/subscription synchronization via cron job
- Manual synchronization endpoint
- Customer management and linking with PocketBase users

## Prerequisites

Before using this code, ensure you have:

1. A LemonSqueezy account with API access
2. PocketBase installed and running
3. The following collections schema imported (create `pb_schema.json`):
   - customer
   - subscription
   - product
   - variant

## Setup

### 1. PocketBase Configuration

First, you'll need to set up PocketBase hooks. Follow these steps:

1. Create a new JavaScript file (e.g., `pb_hooks/main.pb.js`)
2. Copy the provided code into this file
3. Restart your PocketBase server to load the hooks

For more details on setting up PocketBase hooks, refer to the [official PocketBase Hooks documentation](https://pocketbase.io/docs/js-overview/).

### 2. LemonSqueezy Configuration

1. Replace the webhook signing secret:
   ```javascript
   const secret = "your_lemonsqueezy_signing_secret_here";
   ```

2. Replace the API key in all relevant functions:
   ```javascript
   const apiKey = "your_api_key_here";
   ```

3. Update your store ID in the `/create-checkout-session` endpoint:
   ```javascript
   "id": "your_store_id" // Update this in the store relationship object
   ```

## Available Endpoints

### Webhooks
- `POST /lemonsqueezy` - Handles LemonSqueezy webhook events
  - Processes subscription events (created, cancelled, payment success)
  - Automatically updates local database records

### Customer Management
- `POST /create-checkout-session` - Creates a new checkout session
  - Requires authenticated user
  - Automatically creates/links LemonSqueezy customer
  - Returns checkout URL

- `POST /create-portal-link` - Generates customer portal link
  - Requires authenticated user
  - Returns URL to LemonSqueezy customer portal

### Synchronization
- `GET /manual-lemonsqueezy-synchronization` - Manually trigger sync
  - Syncs products, variants, and subscriptions
  - Updates local database records

## Automatic Synchronization

The plugin includes a cron job that runs every 30 minutes to sync data:
The cron job automatically:

- Fetches all subscriptions from LemonSqueezy
- Updates existing subscription records in PocketBase
- Creates new subscription records if they don't exist
- Syncs product and variant data
- Maintains data consistency between LemonSqueezy and PocketBase

