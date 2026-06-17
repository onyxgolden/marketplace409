import type { Owner, OwnerType } from "./owner.types";

export class OwnerService {
  static getDefaultOwnerType(): OwnerType {
    return "person";
  }

  static create(name: string, type: OwnerType): Partial<Owner> {
    return {
      name,
      type,
    };
  }
}