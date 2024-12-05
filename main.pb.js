/**
 * This code defines a route handler for the POST request to the "/lemonsqueezy" endpoint.
 * It verifies the webhook signature using a secret key to ensure the request's authenticity.
 * If the signature is valid, it processes the incoming data based on the event type specified
 * in the webhook payload. The supported events include "subscription_created", "subscription_cancelled",
 * and "subscription_payment_success". For each event, it retrieves the subscription data and checks
 * if a record with the same subscription ID already exists in the database. If it does, the existing
 * record is updated with the new subscription data. If not, a new record is created and saved.
 * The code also logs the received event name for monitoring purposes.
 */

/**
 * Before using this code, please ensure you have imported the required collections schema.
 * Create a file named pb_schema.json in your project root and import the following collections:
 * - customer
 * - subscription  
 * - product
 * - variant
 * 
 * Steps to get the code up and running:
 * 
 * 1. Replace the secret:
 *    - Locate the line in the "/lemonsqueezy" route handler where the secret is defined:
 *      ```javascript
 *      const secret = "your_lemonsqueezy_signing_secret_here";
 *      ```
 *    - Replace "your_lemonsqueezy_signing_secret_here" with your actual secret key that is used to verify the webhook signature.
 * 
 * 2. Replace the API key for each function:
 *    - Identify all instances where the API key is used in the code. These are typically found in HTTP request headers.
 *    - For example, in the "/create-portal-link" route handler, the API key is defined as:
 *      ```javascript
 *      const apiKey = "your_api_key_here";
 *      ```
 *    - Replace "your_api_key_here" with your actual LemonSqueezy API key.
 *    - Ensure that the API key is updated in all relevant functions, such as those handling checkouts, subscriptions, and product synchronizations.
 * 
 * By following these steps, you will configure the application to authenticate requests and interact with the LemonSqueezy API using your credentials.
 */

routerAdd("POST", "/lemonsqueezy", (e) => {
    const secret = "your_lemonsqueezy_signing_secret_here";

    const info = e.requestInfo();
    const signature = info.headers["x_signature"] || '';
    const rawBody = readerToString(e.request.body);

    const hash = $security.hs256(rawBody, secret);

    const isValid = $security.equal(hash, signature);
    if (!isValid) {
        throw new BadRequestError(`Invalid webhook signature.`);
    }
    const data = info.body;
    $app.logger().info("Received data:", "lemonsqueezy", data.meta.event_name, "json", data);

    switch (data.meta.event_name) {
        case "subscription_created":
        case "subscription_cancelled":
        case "subscription_updated":
            try {
                const subscription = data.data;
                const existingSubscriptions = $app.findRecordsByFilter(
                    "subscription",
                    `subscription_id = "${subscription.id}"`
                );

                const subscriptionData = {
                    "subscription_id": subscription.id,
                    "lemonsqueezy_customer_id": subscription.attributes?.customer_id || "",
                    "status": subscription.attributes?.status || "",
                    "variant_id": subscription.attributes?.variant_id || "",
                    "quantity": subscription.attributes?.first_subscription_item?.quantity || 0,
                    "metadata": JSON.stringify({}),
                    "cancel_at_period_end": subscription.attributes?.cancelled || false,
                    "current_period_start": subscription.attributes?.created_at || "",
                    "current_period_end": subscription.attributes?.renews_at || "",
                    "ended_at": subscription.attributes?.ends_at || "",
                    "cancel_at": "",
                    "canceled_at": "",
                    "trial_start": "",
                    "trial_end": subscription.attributes?.trial_ends_at || ""
                };

                if (existingSubscriptions.length > 0) {
                    const record = existingSubscriptions[0];
                    record.load(subscriptionData);
                    $app.save(record);
                } else {
                    const collection = $app.findCollectionByNameOrId("subscription");
                    const record = new Record(collection);
                    record.load(subscriptionData);
                    $app.save(record);
                }
            } catch (err) {
                $app.logger().error("Error processing subscription:", err);
                throw new BadRequestError("Failed to process subscription: " + err.message);
            }
            break;
        default:
            break;
    }
    return e.json(200, { "message": "Data received successfully" });
})

routerAdd("POST", "/create-checkout-session", async (e) => {
    const apiKey = "your_api_key_here";
    const info = e.requestInfo();
    const token = info.headers["authorization"] || '';
    let userRecord;
    try {
        userRecord = (await $app.findAuthRecordByToken(token, $app.settings().recordAuthToken.secret));
    } catch (error) {
        return e.json(400, { "message": "User not authorized" });
    }

    const existingCustomer = $app.findRecordsByFilter(
        "customer",
        `user_id = "${userRecord.id}"`
    );

    let lemonsqueezyCustomerId;

    if (existingCustomer.length > 0) {
        lemonsqueezyCustomerId = existingCustomer[0].getString("lemonsqueezy_customer_id");
    } else {
        const customerResponse = await $http.send({
            url: "https://api.lemonsqueezy.com/v1/customers",
            method: "POST",
            headers: {
                "Accept": "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                "data": {
                    "type": "customers",
                    "attributes": {
                        "name": userRecord.getString("displayName"),
                        "email": userRecord.getString("email"),
                        
                    },
                    "relationships": {
                        "store": {
                          "data": {
                            "type": "stores",
                            "id": "116661"
                          }
                        }
                      }
                }
            })
        });
        
        const customerData = customerResponse.json;
        lemonsqueezyCustomerId = customerData.data.id;

        const collection = $app.findCollectionByNameOrId("customer");
        const newCustomerRecord = new Record(collection);
        newCustomerRecord.load({
            "lemonsqueezy_customer_id": lemonsqueezyCustomerId,
            "user_id": userRecord.id
        });
        $app.save(newCustomerRecord);
    }

    const requestBody = {
        "data": {
            "type": "checkouts",
            "attributes": {
                "checkout_options": {
                    "button_color": "#7047EB"
                },
                "checkout_data": {
                    "name": userRecord.getString("displayName"),
                    "email": userRecord.getString("email"),
                    "custom": {
                        "user_id": userRecord.id,
                    }
                },
                "preview": true
            },
            "relationships": {
                "variant": {
                    "data": {
                        "type": "variants",
                        "id": info.body.variant_id,
                    }
                },
                "store": {
                    "data": {
                      "type": "stores",
                      "id": "116661"
                    }
                  }
            }
        }
    };

    try {
        const response = await $http.send({
            url: "https://api.lemonsqueezy.com/v1/checkouts",
            method: "POST",
            headers: {
                "Accept": "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        const responseData = response.json;
        return e.json(response.status, responseData);
    } catch (error) {
        $app.logger().error("Error creating checkout:", error);
        return e.json(400, { "message": "Failed to create checkout" });
    }
})

routerAdd("GET", "/create-portal-link", async (e) => {
    const apiKey = "your_api_key_here"; // Provided API key
    const info = e.requestInfo();
    const token = info.headers["authorization"] || '';
    let userRecord;
    try {
        userRecord = await $app.findAuthRecordByToken(token, $app.settings().recordAuthToken.secret);
        const customerRecord = await $app.findFirstRecordByFilter(
            "customer",
            `user_id = "${userRecord.id}"`
        );

        if (!customerRecord) {
            return e.json(404, { "message": "Customer not found" });
        }
        
        const response = await $http.send({
            url: `https://api.lemonsqueezy.com/v1/customers/${customerRecord.get('lemonsqueezy_customer_id')}`,
            method: "GET",
            headers: {
                "Accept": "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                "Authorization": `Bearer ${apiKey}`
            }
        });

        const responseData = response.json;
        const customerPortalLink = responseData.data.attributes.urls.customer_portal;

        return e.json(response.status, { "customer_portal_link": customerPortalLink });
    } catch (error) {
        $app.logger().error("Error retrieving customer portal link:", error);
        return e.json(400, { "message": "Failed to retrieve customer portal link" });
    }
})

// Sync LemonSqueezy data every 30 minutes
// cronAdd("*/30 * * * *", () => {
//     const apiKey = "your_api_key_here";

//     try {
//         const subscriptionsRes = $http.send({
//             url: "https://api.lemonsqueezy.com/v1/subscriptions",
//             method: "GET",
//             headers: {
//                 "Accept": "application/vnd.api+json",
//                 "Content-Type": "application/vnd.api+json",
//                 "Authorization": `Bearer ${apiKey}`
//             },
//             timeout: 120
//         });

//         const subscriptionsData = subscriptionsRes.json;

//         subscriptionsData.data.forEach(subscription => {
//             try {
//                 const existingSubscriptions = $app.findRecordsByFilter(
//                     "subscription",
//                     `subscription_id = "${subscription.id}"`
//                 );

//                 const subscriptionData = {
//                     "subscription_id": subscription.id,
//                     "lemonsqueezy_customer_id": subscription.attributes?.customer_id || "",
//                     "status": subscription.attributes?.status || "",
//                     "variant_id": subscription.attributes?.variant_id || "",
//                     "quantity": subscription.attributes?.first_subscription_item?.quantity || 0,
//                     "metadata": JSON.stringify({}),
//                     "cancel_at_period_end": subscription.attributes?.cancelled || false,
//                     "current_period_start": subscription.attributes?.created_at || "",
//                     "current_period_end": subscription.attributes?.renews_at || "",
//                     "ended_at": subscription.attributes?.ends_at || "",
//                     "cancel_at": "",
//                     "canceled_at": "",
//                     "trial_start": "",
//                     "trial_end": subscription.attributes?.trial_ends_at || ""
//                 };

//                 if (existingSubscriptions.length > 0) {
//                     const record = existingSubscriptions[0];
//                     record.load(subscriptionData);
//                     $app.save(record);
//                 } else {
//                     const collection = $app.findCollectionByNameOrId("subscription");
//                     const record = new Record(collection);
//                     record.load(subscriptionData);
//                     $app.save(record);
//                 }
//             } catch (err) {
//                 $app.logger().error("Error processing subscription:", err);
//                 throw new BadRequestError("Failed to process subscription: " + err.message);
//             }
//         });

//         const variantsRes = $http.send({
//             url: "https://api.lemonsqueezy.com/v1/variants",
//             method: "GET",
//             headers: {
//                 "Accept": "application/vnd.api+json",
//                 "Content-Type": "application/vnd.api+json",
//                 "Authorization": `Bearer ${apiKey}`
//             },
//             timeout: 120
//         });

//         const variantsData = variantsRes.json;

//         variantsData.data.forEach(variant => {
//             try {
//                 const existingVariants = $app.findRecordsByFilter(
//                     "variant",
//                     `variant_id = "${variant.id}"`
//                 );

//                 const variantData = {
//                     "variant_id": variant.id,
//                     "product_id": variant.attributes.product_id,
//                     "active": variant.attributes.status === "published",
//                     "description": variant.attributes.description,
//                     "currency": "USD", // Assuming USD, adjust as needed
//                     "unit_amount": variant.attributes.price,
//                     "type": variant.attributes.is_subscription ? "subscription" : "one-time",
//                     "interval": variant.attributes.interval,
//                     "interval_count": variant.attributes.interval_count,
//                     "trial_period_days": variant.attributes.has_free_trial ? variant.attributes.trial_interval_count : 0,
//                     "metadata": JSON.stringify({})
//                 };

//                 if (existingVariants.length > 0) {
//                     const record = existingVariants[0];
//                     record.load(variantData);
//                     $app.save(record);
//                 } else {
//                     const collection = $app.findCollectionByNameOrId("variant");
//                     const record = new Record(collection);
//                     record.load(variantData);
//                     $app.save(record);
//                 }
//             } catch (err) {
//                 $app.logger().error("Error processing variant:", err);
//                 throw new BadRequestError("Failed to process variant: " + err.message);
//             }
//         });

//         const productsRes = $http.send({
//             url: "https://api.lemonsqueezy.com/v1/products",
//             method: "GET",
//             headers: {
//                 "Accept": "application/vnd.api+json",
//                 "Content-Type": "application/vnd.api+json",
//                 "Authorization": `Bearer ${apiKey}`
//             },
//             timeout: 120
//         });

//         const productsData = productsRes.json;

//         productsData.data.forEach(product => {
//             try {
//                 const existingProducts = $app.findRecordsByFilter(
//                     "product",
//                     `product_id = "${product.id}"`
//                 );

//                 const productData = {
//                     "product_id": product.id,
//                     "active": product.attributes.status === "published",
//                     "name": product.attributes.name,
//                     "description": product.attributes.description,
//                     "image": product.attributes.thumb_url,
//                     "metadata": JSON.stringify({})
//                 };

//                 if (existingProducts.length > 0) {
//                     const record = existingProducts[0];
//                     record.load(productData);
//                     $app.save(record);
//                 } else {
//                     const collection = $app.findCollectionByNameOrId("product");
//                     const record = new Record(collection);
//                     record.load(productData);
//                     $app.save(record);
//                 }
//             } catch (err) {
//                 $app.logger().error("Error processing product:", err);
//                 throw new BadRequestError("Failed to process product: " + err.message);
//             }
//         });

//         $app.logger().info("Ran sync", "lemonsqueezy", "success");
//         return e.json(200, { "message": "success" });
//     } catch (error) {
//         $app.logger().error("Error during synchronization:", error);
//         return e.json(400, { "message": error });
//     }
// });

routerAdd("GET","/manual-lemonsqueezy-synchronization", async (e) => {
    const apiKey = "your_api_key_here";

    try {
        const subscriptionsRes = $http.send({
            url: "https://api.lemonsqueezy.com/v1/subscriptions",
            method: "GET",
            headers: {
                "Accept": "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                "Authorization": `Bearer ${apiKey}`
            },
            timeout: 120
        });

        const subscriptionsData = subscriptionsRes.json;

        subscriptionsData.data.forEach(subscription => {
            try {
                const existingSubscriptions = $app.findRecordsByFilter(
                    "subscription",
                    `subscription_id = "${subscription.id}"`
                );

                const subscriptionData = {
                    "subscription_id": subscription.id,
                    "lemonsqueezy_customer_id": subscription.attributes?.customer_id || "",
                    "status": subscription.attributes?.status || "",
                    "variant_id": subscription.attributes?.variant_id || "",
                    "quantity": subscription.attributes?.first_subscription_item?.quantity || 0,
                    "metadata": JSON.stringify({}),
                    "cancel_at_period_end": subscription.attributes?.cancelled || false,
                    "current_period_start": subscription.attributes?.created_at || "",
                    "current_period_end": subscription.attributes?.renews_at || "",
                    "ended_at": subscription.attributes?.ends_at || "",
                    "cancel_at": "",
                    "canceled_at": "",
                    "trial_start": "",
                    "trial_end": subscription.attributes?.trial_ends_at || ""
                };

                if (existingSubscriptions.length > 0) {
                    const record = existingSubscriptions[0];
                    record.load(subscriptionData);
                    $app.save(record);
                } else {
                    const collection = $app.findCollectionByNameOrId("subscription");
                    const record = new Record(collection);
                    record.load(subscriptionData);
                    $app.save(record);
                }
            } catch (err) {
                $app.logger().error("Error processing subscription:", err);
                throw new BadRequestError("Failed to process subscription: " + err.message);
            }
        });

        const variantsRes = $http.send({
            url: "https://api.lemonsqueezy.com/v1/variants",
            method: "GET",
            headers: {
                "Accept": "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                "Authorization": `Bearer ${apiKey}`
            },
            timeout: 120
        });

        const variantsData = variantsRes.json;

        variantsData.data.forEach(variant => {
            try {
                const existingVariants = $app.findRecordsByFilter(
                    "variant",
                    `variant_id = "${variant.id}"`
                );

                const variantData = {
                    "variant_id": variant.id,
                    "product_id": variant.attributes.product_id,
                    "active": variant.attributes.status === "published",
                    "description": variant.attributes.description,
                    "currency": "USD", // Assuming USD, adjust as needed
                    "unit_amount": variant.attributes.price,
                    "type": variant.attributes.is_subscription ? "subscription" : "one-time",
                    "interval": variant.attributes.interval,
                    "interval_count": variant.attributes.interval_count,
                    "trial_period_days": variant.attributes.has_free_trial ? variant.attributes.trial_interval_count : 0,
                    "metadata": JSON.stringify({})
                };

                if (existingVariants.length > 0) {
                    const record = existingVariants[0];
                    record.load(variantData);
                    $app.save(record);
                } else {
                    const collection = $app.findCollectionByNameOrId("variant");
                    const record = new Record(collection);
                    record.load(variantData);
                    $app.save(record);
                }
            } catch (err) {
                $app.logger().error("Error processing variant:", err);
                throw new BadRequestError("Failed to process variant: " + err.message);
            }
        });

        const productsRes = $http.send({
            url: "https://api.lemonsqueezy.com/v1/products",
            method: "GET",
            headers: {
                "Accept": "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                "Authorization": `Bearer ${apiKey}`
            },
            timeout: 120
        });

        const productsData = productsRes.json;

        productsData.data.forEach(product => {
            try {
                const existingProducts = $app.findRecordsByFilter(
                    "product",
                    `product_id = "${product.id}"`
                );

                const productData = {
                    "product_id": product.id,
                    "active": product.attributes.status === "published",
                    "name": product.attributes.name,
                    "description": product.attributes.description,
                    "image": product.attributes.thumb_url,
                    "metadata": JSON.stringify({})
                };

                if (existingProducts.length > 0) {
                    const record = existingProducts[0];
                    record.load(productData);
                    $app.save(record);
                } else {
                    const collection = $app.findCollectionByNameOrId("product");
                    const record = new Record(collection);
                    record.load(productData);
                    $app.save(record);
                }
            } catch (err) {
                $app.logger().error("Error processing product:", err);
                throw new BadRequestError("Failed to process product: " + err.message);
            }
        });

        $app.logger().info("Ran sync", "lemonsqueezy", "success");
        return e.json(200, { "message": "success" });
    } catch (error) {
        $app.logger().error("Error during synchronization:", error);
        return e.json(400, { "message": error });
    }
})