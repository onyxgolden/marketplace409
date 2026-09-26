/** A user-facing DXF import failure (message is shown as-is). */
export class DxfImportError extends Error {
  constructor(message, { code = "dxf-import" } = {}) {
    super(message);
    this.name = "DxfImportError";
    this.code = code;
  }
}
