import type { PageMetadata } from '../../../shared/application/pagination';
import iamModule from '../../iam';
const { authComponentsDto: componentsAuthModule } = iamModule;
const { UserChangeLogComponent } = componentsAuthModule;

function ListUserChangeLogsResponseDTO(
  rows: Array<Parameters<typeof UserChangeLogComponent.build>[0]>,
  metadata: PageMetadata
) {
  return {
    data: Array.isArray(rows) ? rows.map(r => UserChangeLogComponent.build(r)) : [],
    metadata
  };
}

function ListChangeLogsResponseDTO<T, R>(rows: T[], metadata: PageMetadata, buildFn: (row: T) => R) {
  return {
    data: Array.isArray(rows) ? rows.map(buildFn) : [],
    metadata
  };
}

export default {
  ListUserChangeLogsResponseDTO,
  ListChangeLogsResponseDTO
};
