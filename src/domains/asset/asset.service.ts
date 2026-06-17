import type { Asset } from "./asset.types";

export class AssetService {
  static getTotalValue(assets: Asset[]): number {
    return assets.reduce((sum, asset) => sum + asset.current_value, 0);
  }
}