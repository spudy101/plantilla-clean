// Pedido de página para tests de repositorios y services: el que arma pageRequest() desde una query ya
// validada (shared/http/pagination.ts). Por defecto: página 1 de 10, por createdAt descendente.
import { pageRequest, type PageRequest } from '../../src/shared/http/pagination';

export function page(overrides: Partial<Omit<PageRequest, 'offset'>> = {}): PageRequest {
  return pageRequest({ page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC', ...overrides });
}
