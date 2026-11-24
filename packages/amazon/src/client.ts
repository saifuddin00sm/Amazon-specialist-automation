import { listingsItemsOperations } from "./listings-items";
import { listingsRestrictionsOperations } from "./listings-restrictions";
import { productTypeDefinitionsOperations } from "./product-type-definitions";
import { createSpApiRequest, type SpApiClientOptions } from "./sp-api";

/** A typed SP-API client for one region. */
export function createSpApiClient(options: SpApiClientOptions) {
  const request = createSpApiRequest(options);
  return { ...listingsItemsOperations(request), ...listingsRestrictionsOperations(request), ...productTypeDefinitionsOperations(request) };
}

export type SpApiClient = ReturnType<typeof createSpApiClient>;
