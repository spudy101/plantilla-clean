// Puerto: quiénes pueden aprobar. Los usuarios y sus roles son de iam; lo implementa
// src/main/adapters/approval-sources.adapter.ts.

export interface ApproverDirectory {
  /** Ids de los usuarios activos con alguno de esos roles. */
  activeUserIdsWithRoles(roleNames: readonly string[]): Promise<string[]>;
}
