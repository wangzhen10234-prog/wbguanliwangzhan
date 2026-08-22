export function normalizeProductSku(value: string) {
  return value.toLocaleLowerCase().replace(/[\s_.-]+/g, "");
}

// WB 会为颜色或规格生成独立卖家编码；这些编码共用登记表中的成本母编码。
const COST_SOURCE_BY_WB_SKU = new Map<string, string>(
  [
    ["wzXxingjiaW", "wz X型架w"],
    ["wzXxingjiaB", "wz X型架B"],
    ["wz00555W", "wz0055"],
    ["wz00555B", "wz0055"],
    ["wzS2W", "wzS2"],
    ["wzS2BU", "wzS2"],
    ["wzljd", "垃圾袋"],
    ["wzA75W", "wzA75"],
    ["wzA75B", "wzA75"],
    ["wzA73W", "wzA73"],
    ["wzA73B", "wzA73"],
    ["wz090", "wz0090"],
    ["wz091", "wz0091"],
    ["wzK801GP", "wzK801"],
    ["wzK801WG", "wzK801"],
    ["wzK801P", "wzK801"],
    ["wzK804W", "wzK804"],
    ["wzK804P", "wzK804"],
    ["wzTW-016", "wzTW-016彩色"],
    ["wzA70B", "wzA70"],
    ["wzA70W", "wzA70"],
    ["wz810H", "wz810B"],
    ["wz810X", "wz810G"],
    ["wz810L", "wz810P"],
  ].map(([wbSku, sourceSku]) => [normalizeProductSku(wbSku), normalizeProductSku(sourceSku)]),
);

export function productCostSourceKey(sellerSku: string) {
  const key = normalizeProductSku(sellerSku);
  return COST_SOURCE_BY_WB_SKU.get(key) ?? key;
}
