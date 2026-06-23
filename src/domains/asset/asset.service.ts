import { AssetRepository } from "./asset.repository";
import type { Asset } from "./asset.types";

class AssetServiceImpl {
  async getAll(): Promise<Asset[]> {
    return AssetRepository.getAll();
  }

  getTotalValue(assets: Asset[]): number {
    return assets.reduce((sum, asset) => sum + asset.current_value, 0);
  }
}

export const AssetService = new AssetServiceImpl();
