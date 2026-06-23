import { BaseRepository } from "@/repositories";
import { mapAssetRowToAsset } from "./asset.mapper";
import type { Asset } from "./asset.types";

class AssetRepositoryImpl extends BaseRepository<any> {
  constructor() {
    super("assets");
  }

  async getAll(): Promise<Asset[]> {
    const rows = await super.getAll();
    return rows.map(mapAssetRowToAsset);
  }
}

export const AssetRepository = new AssetRepositoryImpl();
