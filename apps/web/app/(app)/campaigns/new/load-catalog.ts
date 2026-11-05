import { guardrailsFor, type Currency, type Guardrails, type Product } from "@app/core";
import { getDataSource } from "@/lib/data";

/** One product the wizard can advertise or target, with the keywords its ProductFacts suggest. */
export type CatalogProduct = Pick<Product, "id" | "asin" | "sku" | "title" | "brand" | "category" | "price" | "status"> & {
  targetKeywords: string[];
};

export type CatalogAccount = {
  id: string;
  currency: Currency;
  targetAcos: number;
  guardrails: Guardrails;
  products: CatalogProduct[];
};

/** Every account's catalog; the wizard narrows to the account picked in the top bar. */
export async function loadCatalog(): Promise<Record<string, CatalogAccount>> {
  const dataSource = await getDataSource();
  const accounts = await dataSource.listSellerAccounts();
  const entries = await Promise.all(
    accounts.map(async (account): Promise<[string, CatalogAccount]> => {
      const products = await dataSource.listProducts({ sellerAccountId: account.id });
      const facts = await Promise.all(products.map((product) => dataSource.getProductFacts(product.id)));
      return [
        account.id,
        {
          id: account.id,
          currency: account.currency,
          targetAcos: account.targetAcos,
          guardrails: guardrailsFor(account),
          products: products.map((product, i) => ({
            id: product.id,
            asin: product.asin,
            sku: product.sku,
            title: product.title,
            brand: product.brand,
            category: product.category,
            price: product.price,
            status: product.status,
            targetKeywords: facts[i]?.targetKeywords ?? [],
          })),
        },
      ];
    }),
  );
  return Object.fromEntries(entries);
}
